import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loginNoumena, refreshNoumenaToken } from "../src/utils/oauth/noumena.ts";

const expectedScopes = [
	"org:create_api_key",
	"user:profile",
	"user:inference",
	"user:sessions:ncode",
	"user:mcp_servers",
	"user:file_upload",
];

type BuiltinModuleLoader = (specifier: string) => object | undefined;
type ProcessWithBuiltinModule = {
	getBuiltinModule?: BuiltinModuleLoader;
};
type RequestListener = (req: IncomingMessage, res: ServerResponse) => void;
type FakeServer = {
	on: (event: "error", listener: (error: Error) => void) => FakeServer;
	listen: (port: number, host: string, callback: () => void) => void;
	address: () => { port: number };
	close: () => void;
};

let originalGetBuiltinModule: BuiltinModuleLoader | undefined;

function jsonResponse(body: unknown, status: number = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"Content-Type": "application/json",
		},
	});
}

function getUrl(input: unknown): string {
	if (typeof input === "string") {
		return input;
	}
	if (input instanceof URL) {
		return input.toString();
	}
	if (input instanceof Request) {
		return input.url;
	}
	throw new Error(`Unsupported fetch input: ${String(input)}`);
}

function getFormBody(init?: RequestInit): URLSearchParams {
	if (!(init?.body instanceof URLSearchParams)) {
		throw new Error(`Expected URLSearchParams request body, got ${typeof init?.body}`);
	}
	return init.body;
}

function getJsonBody(init?: RequestInit): Record<string, string> {
	if (typeof init?.body !== "string") {
		throw new Error(`Expected string request body, got ${typeof init?.body}`);
	}
	return JSON.parse(init.body) as Record<string, string>;
}

function stubHttpServer(): void {
	const processWithBuiltinModule = process as unknown as ProcessWithBuiltinModule;
	originalGetBuiltinModule = processWithBuiltinModule.getBuiltinModule;
	processWithBuiltinModule.getBuiltinModule = (specifier: string) => {
		if (specifier !== "node:http") {
			return originalGetBuiltinModule?.(specifier);
		}
		return {
			createServer: (_listener?: RequestListener): FakeServer => {
				const server: FakeServer = {
					on: () => server,
					listen: (_port, _host, callback) => {
						callback();
					},
					address: () => ({ port: 53692 }),
					close: () => {},
				};
				return server;
			},
		};
	};
}

describe.sequential("Noumena OAuth", () => {
	afterEach(() => {
		(process as unknown as ProcessWithBuiltinModule).getBuiltinModule = originalGetBuiltinModule;
		originalGetBuiltinModule = undefined;
		vi.unstubAllGlobals();
	});

	it("builds the Noumena auth URL and exchanges a PKCE authorization code", async () => {
		stubHttpServer();
		let authUrl = "";
		let expectedRedirectUri = "";
		let expectedState = "";

		const fetchMock = vi.fn(async (input: unknown, init?: RequestInit): Promise<Response> => {
			expect(getUrl(input)).toBe("https://api.noumena.com/oauth/token");
			expect(init?.method).toBe("POST");
			expect(init?.headers).toMatchObject({
				"Content-Type": "application/x-www-form-urlencoded",
				Accept: "application/json",
			});
			const body = getFormBody(init);
			expect(body.get("grant_type")).toBe("authorization_code");
			expect(body.get("code")).toBe("manual-code");
			expect(body.get("redirect_uri")).toBe(expectedRedirectUri);
			expect(body.get("client_id")).toBe("noumena-code");
			expect(body.get("code_verifier")).toBeTruthy();
			expect(body.get("state")).toBe(expectedState);
			return jsonResponse({
				access_token: "access-token",
				refresh_token: "refresh-token",
				expires_in: 3600,
				scope: expectedScopes.join(" "),
			});
		});
		vi.stubGlobal("fetch", fetchMock);

		const credentials = await loginNoumena({
			onAuth: (info) => {
				authUrl = info.url;
				const url = new URL(info.url);
				expect(`${url.origin}${url.pathname}`).toBe("https://code.noumena.com/oauth/authorize");
				expect(url.searchParams.get("code")).toBe("true");
				expect(url.searchParams.get("client_id")).toBe("noumena-code");
				expect(url.searchParams.get("response_type")).toBe("code");
				expectedRedirectUri = url.searchParams.get("redirect_uri") ?? "";
				expectedState = url.searchParams.get("state") ?? "";
				expect(expectedRedirectUri).toMatch(/^http:\/\/localhost:\d+\/callback$/);
				expect(url.searchParams.get("scope")?.split(" ")).toEqual(expectedScopes);
				expect(url.searchParams.get("code_challenge")).toBeTruthy();
				expect(url.searchParams.get("code_challenge_method")).toBe("S256");
				expect(expectedState).toBeTruthy();
			},
			onPrompt: async () => "",
			onManualCodeInput: async () => {
				const url = new URL(authUrl);
				const state = url.searchParams.get("state");
				const redirectUri = url.searchParams.get("redirect_uri");
				if (!state || !redirectUri) {
					throw new Error("Missing OAuth state or redirect_uri in auth URL");
				}
				return `${redirectUri}?code=manual-code&state=${state}`;
			},
		});

		expect(credentials.access).toBe("access-token");
		expect(credentials.refresh).toBe("refresh-token");
		expect(credentials.scopes).toEqual(expectedScopes);
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it("refreshes with Noumena scopes and preserves the previous refresh token when omitted", async () => {
		const fetchMock = vi.fn(async (input: unknown, init?: RequestInit): Promise<Response> => {
			expect(getUrl(input)).toBe("https://api.noumena.com/oauth/token");
			expect(init?.method).toBe("POST");
			expect(init?.headers).toMatchObject({
				"Content-Type": "application/json",
				Accept: "application/json",
			});
			const body = getJsonBody(init);
			expect(body.grant_type).toBe("refresh_token");
			expect(body.refresh_token).toBe("refresh-token");
			expect(body.client_id).toBe("noumena-code");
			expect(body.scope.split(" ")).toEqual(expectedScopes);
			return jsonResponse({
				access_token: "new-access-token",
				expires_in: 3600,
				scope: expectedScopes.join(" "),
			});
		});
		vi.stubGlobal("fetch", fetchMock);

		const credentials = await refreshNoumenaToken("refresh-token");

		expect(credentials.access).toBe("new-access-token");
		expect(credentials.refresh).toBe("refresh-token");
		expect(credentials.scopes).toEqual(expectedScopes);
		expect(fetchMock).toHaveBeenCalledOnce();
	});
});
