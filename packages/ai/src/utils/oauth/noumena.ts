/**
 * Noumena OAuth flow.
 *
 * NOTE: This module uses Node.js http.createServer for the OAuth callback server.
 * It is only intended for CLI use, not browser environments.
 */

import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { getProviderEnvValue } from "../provider-env.ts";
import { oauthErrorHtml, oauthSuccessHtml } from "./oauth-page.ts";
import { generatePKCE } from "./pkce.ts";
import type { OAuthCredentials, OAuthLoginCallbacks, OAuthPrompt, OAuthProviderInterface } from "./types.ts";

type CallbackServerInfo = {
	server: Server;
	redirectUri: string;
	cancelWait: () => void;
	waitForCode: () => Promise<{ code: string; state: string } | null>;
};

type NoumenaTokenResponse = {
	access_token?: string;
	refresh_token?: string;
	expires_in?: number;
	scope?: string;
};

type ParsedNoumenaTokenResponse = {
	accessToken: string;
	refreshToken?: string;
	expiresIn: number;
	scope: string;
};

type CreateServer = (requestListener?: (req: IncomingMessage, res: ServerResponse) => void) => Server;
type NodeHttpModule = {
	createServer: CreateServer;
};

const DEFAULT_ISSUER_BASE_URL = "https://api.noumena.com";
const DEFAULT_OAUTH_WEB_BASE_URL = "https://code.noumena.com";
const DEFAULT_CLIENT_ID = "noumena-code";
const CALLBACK_HOST = getProviderEnvValue("PI_OAUTH_CALLBACK_HOST") || "127.0.0.1";
const CALLBACK_PATH = "/callback";
const OAUTH_SCOPES = [
	"org:create_api_key",
	"user:profile",
	"user:inference",
	"user:sessions:ncode",
	"user:mcp_servers",
	"user:file_upload",
].join(" ");

function normalizeBaseUrl(url: string): string {
	return url.replace(/\/+$/, "");
}

function getIssuerBaseUrl(): string {
	return normalizeBaseUrl(getProviderEnvValue("NOUMENA_ISSUER_BASE_URL") || DEFAULT_ISSUER_BASE_URL);
}

function getOAuthWebBaseUrl(): string {
	return normalizeBaseUrl(getProviderEnvValue("NOUMENA_OAUTH_WEB_BASE_URL") || DEFAULT_OAUTH_WEB_BASE_URL);
}

function getClientId(): string {
	return getProviderEnvValue("NOUMENA_OAUTH_CLIENT_ID") || DEFAULT_CLIENT_ID;
}

function getAuthorizeUrl(): string {
	return `${getOAuthWebBaseUrl()}/oauth/authorize`;
}

function getTokenUrl(): string {
	return `${getIssuerBaseUrl()}/oauth/token`;
}

function getCreateServer(): CreateServer {
	if (typeof process === "undefined" || (!process.versions?.node && !process.versions?.bun)) {
		throw new Error("Noumena OAuth is only available in Node.js environments");
	}

	const getBuiltinModule = process.getBuiltinModule as ((specifier: string) => unknown) | undefined;
	const httpModule = getBuiltinModule?.("node:http") as NodeHttpModule | undefined;
	if (!httpModule?.createServer) {
		throw new Error("Noumena OAuth could not load node:http");
	}

	return httpModule.createServer;
}

function createState(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return Array.from(bytes)
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

function parseAuthorizationInput(input: string): { code?: string; state?: string } {
	const value = input.trim();
	if (!value) return {};

	try {
		const url = new URL(value);
		return {
			code: url.searchParams.get("code") ?? undefined,
			state: url.searchParams.get("state") ?? undefined,
		};
	} catch {
		// not a URL
	}

	if (value.includes("#")) {
		const [code, state] = value.split("#", 2);
		return { code, state };
	}

	if (value.includes("code=")) {
		const params = new URLSearchParams(value);
		return {
			code: params.get("code") ?? undefined,
			state: params.get("state") ?? undefined,
		};
	}

	return { code: value };
}

function formatErrorDetails(error: unknown): string {
	if (error instanceof Error) {
		const details = [`${error.name}: ${error.message}`];
		const errorWithCode = error as Error & { code?: string; errno?: number | string; cause?: unknown };
		if (errorWithCode.code) details.push(`code=${errorWithCode.code}`);
		if (typeof errorWithCode.errno !== "undefined") details.push(`errno=${String(errorWithCode.errno)}`);
		if (typeof error.cause !== "undefined") {
			details.push(`cause=${formatErrorDetails(error.cause)}`);
		}
		if (error.stack) {
			details.push(`stack=${error.stack}`);
		}
		return details.join("; ");
	}
	return String(error);
}

function ensureTokenResponse(
	data: NoumenaTokenResponse,
	operation: string,
	responseBody: string,
	options: { requireRefreshToken: boolean },
): ParsedNoumenaTokenResponse {
	if (
		!data.access_token ||
		typeof data.expires_in !== "number" ||
		(options.requireRefreshToken && !data.refresh_token)
	) {
		throw new Error(`Noumena token ${operation} response missing fields: ${responseBody}`);
	}
	return {
		accessToken: data.access_token,
		refreshToken: data.refresh_token,
		expiresIn: data.expires_in,
		scope: data.scope ?? "",
	};
}

async function startCallbackServer(expectedState: string): Promise<CallbackServerInfo> {
	const createServer = getCreateServer();
	return new Promise((resolve, reject) => {
		let settleWait: ((value: { code: string; state: string } | null) => void) | undefined;
		const waitForCodePromise = new Promise<{ code: string; state: string } | null>((resolveWait) => {
			let settled = false;
			settleWait = (value) => {
				if (settled) return;
				settled = true;
				resolveWait(value);
			};
		});

		const server = createServer((req, res) => {
			try {
				const url = new URL(req.url || "", "http://localhost");
				if (url.pathname !== CALLBACK_PATH) {
					res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
					res.end(oauthErrorHtml("Callback route not found."));
					return;
				}

				const code = url.searchParams.get("code");
				const state = url.searchParams.get("state");
				const error = url.searchParams.get("error");

				if (error) {
					res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
					res.end(oauthErrorHtml("Noumena authentication did not complete.", `Error: ${error}`));
					return;
				}

				if (!code || !state) {
					res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
					res.end(oauthErrorHtml("Missing code or state parameter."));
					return;
				}

				if (state !== expectedState) {
					res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
					res.end(oauthErrorHtml("State mismatch."));
					return;
				}

				res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
				res.end(oauthSuccessHtml("Noumena authentication completed. You can close this window."));
				settleWait?.({ code, state });
			} catch {
				res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
				res.end("Internal error");
			}
		});

		server.on("error", (err) => {
			reject(err);
		});

		server.listen(0, CALLBACK_HOST, () => {
			const address = server.address();
			const port = typeof address === "object" && address ? address.port : undefined;
			if (!port) {
				reject(new Error("Noumena OAuth callback server did not report a port"));
				return;
			}
			const redirectUri = `http://localhost:${port}${CALLBACK_PATH}`;
			resolve({
				server,
				redirectUri,
				cancelWait: () => {
					settleWait?.(null);
				},
				waitForCode: () => waitForCodePromise,
			});
		});
	});
}

async function postForm(url: string, body: URLSearchParams, signal?: AbortSignal): Promise<string> {
	const response = await fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Accept: "application/json",
		},
		body,
		signal,
	});

	const responseBody = await response.text();
	if (!response.ok) {
		throw new Error(`HTTP request failed. status=${response.status}; url=${url}; body=${responseBody}`);
	}
	return responseBody;
}

async function postJson(url: string, body: Record<string, string>, signal?: AbortSignal): Promise<string> {
	const response = await fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json",
		},
		body: JSON.stringify(body),
		signal,
	});

	const responseBody = await response.text();
	if (!response.ok) {
		throw new Error(`HTTP request failed. status=${response.status}; url=${url}; body=${responseBody}`);
	}
	return responseBody;
}

function parseTokenResponse(
	responseBody: string,
	operation: string,
	options: { requireRefreshToken: boolean },
): ParsedNoumenaTokenResponse {
	try {
		return ensureTokenResponse(JSON.parse(responseBody) as NoumenaTokenResponse, operation, responseBody, options);
	} catch (error) {
		if (error instanceof SyntaxError) {
			throw new Error(`Noumena token ${operation} returned invalid JSON. body=${responseBody}`);
		}
		throw error;
	}
}

function credentialsFromToken(data: ParsedNoumenaTokenResponse, fallbackRefreshToken?: string): OAuthCredentials {
	const refreshToken = data.refreshToken ?? fallbackRefreshToken;
	if (!refreshToken) {
		throw new Error("Noumena token response missing refresh token");
	}
	return {
		refresh: refreshToken,
		access: data.accessToken,
		expires: Date.now() + data.expiresIn * 1000 - 5 * 60 * 1000,
		scopes: data.scope ? data.scope.split(" ").filter(Boolean) : [],
	};
}

async function exchangeAuthorizationCode(
	code: string,
	state: string,
	verifier: string,
	redirectUri: string,
	signal?: AbortSignal,
): Promise<OAuthCredentials> {
	const tokenUrl = getTokenUrl();
	let responseBody: string;
	try {
		responseBody = await postForm(
			tokenUrl,
			new URLSearchParams({
				grant_type: "authorization_code",
				code,
				redirect_uri: redirectUri,
				client_id: getClientId(),
				code_verifier: verifier,
				state,
			}),
			signal,
		);
	} catch (error) {
		throw new Error(
			`Noumena token exchange request failed. url=${tokenUrl}; redirect_uri=${redirectUri}; details=${formatErrorDetails(error)}`,
		);
	}

	return credentialsFromToken(parseTokenResponse(responseBody, "exchange", { requireRefreshToken: true }));
}

/**
 * Login with Noumena OAuth (authorization code + PKCE).
 */
export async function loginNoumena(options: {
	onAuth: (info: { url: string; instructions?: string }) => void;
	onPrompt: (prompt: OAuthPrompt) => Promise<string>;
	onProgress?: (message: string) => void;
	onManualCodeInput?: () => Promise<string>;
	signal?: AbortSignal;
}): Promise<OAuthCredentials> {
	const { verifier, challenge } = await generatePKCE();
	const state = createState();
	const server = await startCallbackServer(state);

	let code: string | undefined;
	let receivedState: string | undefined;

	try {
		const authParams = new URLSearchParams({
			code: "true",
			client_id: getClientId(),
			response_type: "code",
			redirect_uri: server.redirectUri,
			scope: OAUTH_SCOPES,
			code_challenge: challenge,
			code_challenge_method: "S256",
			state,
		});

		options.onAuth({
			url: `${getAuthorizeUrl()}?${authParams.toString()}`,
			instructions:
				"Complete login in your browser. If the browser is on another machine, paste the final redirect URL here.",
		});

		if (options.onManualCodeInput) {
			let manualInput: string | undefined;
			let manualError: Error | undefined;
			const manualPromise = options
				.onManualCodeInput()
				.then((input) => {
					manualInput = input;
					server.cancelWait();
				})
				.catch((err) => {
					manualError = err instanceof Error ? err : new Error(String(err));
					server.cancelWait();
				});

			const result = await server.waitForCode();
			if (manualError) {
				throw manualError;
			}

			if (result?.code) {
				code = result.code;
				receivedState = result.state;
			} else if (manualInput) {
				const parsed = parseAuthorizationInput(manualInput);
				if (parsed.state && parsed.state !== state) {
					throw new Error("OAuth state mismatch");
				}
				code = parsed.code;
				receivedState = parsed.state ?? state;
			}

			if (!code) {
				await manualPromise;
				if (manualError) {
					throw manualError;
				}
				if (manualInput) {
					const parsed = parseAuthorizationInput(manualInput);
					if (parsed.state && parsed.state !== state) {
						throw new Error("OAuth state mismatch");
					}
					code = parsed.code;
					receivedState = parsed.state ?? state;
				}
			}
		} else {
			const result = await server.waitForCode();
			if (result?.code) {
				code = result.code;
				receivedState = result.state;
			}
		}

		if (!code) {
			const input = await options.onPrompt({
				message: "Paste the authorization code or full redirect URL:",
				placeholder: server.redirectUri,
			});
			const parsed = parseAuthorizationInput(input);
			if (parsed.state && parsed.state !== state) {
				throw new Error("OAuth state mismatch");
			}
			code = parsed.code;
			receivedState = parsed.state ?? state;
		}

		if (!code) {
			throw new Error("Missing authorization code");
		}

		if (!receivedState) {
			throw new Error("Missing OAuth state");
		}

		options.onProgress?.("Exchanging authorization code for tokens...");
		return exchangeAuthorizationCode(code, receivedState, verifier, server.redirectUri, options.signal);
	} finally {
		server.server.close();
	}
}

/**
 * Refresh Noumena OAuth token.
 */
export async function refreshNoumenaToken(refreshToken: string): Promise<OAuthCredentials> {
	const tokenUrl = getTokenUrl();
	let responseBody: string;
	try {
		responseBody = await postJson(tokenUrl, {
			grant_type: "refresh_token",
			refresh_token: refreshToken,
			client_id: getClientId(),
			scope: OAUTH_SCOPES,
		});
	} catch (error) {
		throw new Error(`Noumena token refresh request failed. url=${tokenUrl}; details=${formatErrorDetails(error)}`);
	}

	return credentialsFromToken(
		parseTokenResponse(responseBody, "refresh", { requireRefreshToken: false }),
		refreshToken,
	);
}

export const noumenaOAuthProvider: OAuthProviderInterface = {
	id: "noumena",
	name: "Noumena",
	usesCallbackServer: true,

	async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
		return loginNoumena({
			onAuth: callbacks.onAuth,
			onPrompt: callbacks.onPrompt,
			onProgress: callbacks.onProgress,
			onManualCodeInput: callbacks.onManualCodeInput,
			signal: callbacks.signal,
		});
	},

	async refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
		return refreshNoumenaToken(credentials.refresh);
	},

	getApiKey(credentials: OAuthCredentials): string {
		return credentials.access;
	},
};
