import type { ProviderEnv, Transport } from "../types.ts";
import { getProviderEnvValue } from "../utils/provider-env.ts";

type NativeRequire = (id: string) => unknown;
type NodeModuleModule = {
	createRequire: (url: string) => NativeRequire;
};
type NodePathModule = {
	dirname: (path: string) => string;
	resolve: (...paths: string[]) => string;
};
type NodeUrlModule = {
	fileURLToPath: (url: string) => string;
};
type ProcessWithBuiltinModule = {
	argv?: string[];
	env?: Record<string, string | undefined>;
	execPath?: string;
	getBuiltinModule?: (specifier: string) => unknown;
	versions?: { bun?: string; node?: string };
};

export type NativeNoumenaWsV2Binding = {
	wsV2NativeAvailable?: () => boolean;
	wsV2Connect?: (
		url: string,
		headersJson?: string | null,
		clientName?: string | null,
		optionsJson?: string | null,
	) => Promise<string>;
	wsV2Start?: (sessionId: string, requestId: string, payloadJson: string) => Promise<void>;
	wsV2Next?: (sessionId: string) => Promise<string | null>;
	wsV2Cancel?: (sessionId: string, requestId: string) => Promise<void>;
	wsV2Close?: (sessionId: string) => Promise<void>;
};

export type NoumenaOpenAICompatWsV2TransportArgs = {
	url: string;
	headers: Headers;
	request: unknown;
	signal?: AbortSignal;
	timeoutMs?: number;
	websocketConnectTimeoutMs?: number;
};

export type NoumenaOpenAICompatWsV2Transport = (args: NoumenaOpenAICompatWsV2TransportArgs) => Promise<Response>;

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type NoumenaOpenAICompatWsV2FetchOptions = {
	env?: ProviderEnv;
	timeoutMs?: number;
	transport?: Transport;
	websocketConnectTimeoutMs?: number;
};

type ParsedFetchRequest = {
	body: unknown;
	headers: Headers;
	signal?: AbortSignal;
	url: string;
};

const NATIVE_PACKAGE_RELATIVE_PATH = "native/openai-compat-ws-v2-napi";

function getProcess(): ProcessWithBuiltinModule | undefined {
	return typeof process === "undefined" ? undefined : (process as ProcessWithBuiltinModule);
}

function getBuiltinModule<T>(specifier: string): T | undefined {
	return getProcess()?.getBuiltinModule?.(specifier) as T | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isTruthyTransportFlag(value: string | undefined): boolean {
	if (value === undefined) return true;
	const normalized = value.trim().toLowerCase();
	return normalized !== "0" && normalized !== "false" && normalized !== "no" && normalized !== "off";
}

export function shouldUseNoumenaOpenAICompatWsV2(args: {
	baseUrl: string;
	env?: ProviderEnv;
	provider: string;
	transport?: Transport;
}): boolean {
	if (args.transport === "sse") return false;
	if (args.provider !== "noumena" && !args.baseUrl.includes("api.noumena.com")) return false;
	const flag =
		getProviderEnvValue("NPI_OPENAI_COMPAT_WS_V2", args.env) ??
		getProviderEnvValue("NCODE_OPENAI_COMPAT_WS_V2", args.env);
	return isTruthyTransportFlag(flag);
}

function candidateNativeBindingModuleIds(): string[] {
	const candidates = new Set<string>();
	candidates.add("../../native/openai-compat-ws-v2-napi");
	candidates.add("../native/openai-compat-ws-v2-napi");

	const pathModule = getBuiltinModule<NodePathModule>("node:path");
	const urlModule = getBuiltinModule<NodeUrlModule>("node:url");
	if (pathModule && urlModule) {
		try {
			const moduleDir = pathModule.dirname(urlModule.fileURLToPath(import.meta.url));
			candidates.add(pathModule.resolve(moduleDir, "..", NATIVE_PACKAGE_RELATIVE_PATH));
			candidates.add(pathModule.resolve(moduleDir, "..", "..", NATIVE_PACKAGE_RELATIVE_PATH));
		} catch {
			// Other candidates can still work.
		}

		const proc = getProcess();
		for (const invokedPath of [proc?.argv?.[1], proc?.execPath]) {
			if (!invokedPath) continue;
			const invokedDir = pathModule.dirname(pathModule.resolve(invokedPath));
			candidates.add(pathModule.resolve(invokedDir, NATIVE_PACKAGE_RELATIVE_PATH));
			candidates.add(pathModule.resolve(invokedDir, "..", NATIVE_PACKAGE_RELATIVE_PATH));
		}
	}

	return [...candidates];
}

function validateNativeBinding(binding: NativeNoumenaWsV2Binding): NativeNoumenaWsV2Binding | null {
	if (binding.wsV2NativeAvailable?.() !== true) return null;
	if (
		typeof binding.wsV2Connect !== "function" ||
		typeof binding.wsV2Start !== "function" ||
		typeof binding.wsV2Next !== "function" ||
		typeof binding.wsV2Cancel !== "function" ||
		typeof binding.wsV2Close !== "function"
	) {
		return null;
	}
	return binding;
}

function loadNativeBinding(): NativeNoumenaWsV2Binding | null {
	const moduleModule = getBuiltinModule<NodeModuleModule>("node:module");
	if (!moduleModule?.createRequire) return null;
	const nativeRequire = moduleModule.createRequire(import.meta.url);
	for (const moduleId of candidateNativeBindingModuleIds()) {
		try {
			const binding = nativeRequire(moduleId) as NativeNoumenaWsV2Binding;
			const validBinding = validateNativeBinding(binding);
			if (validBinding) return validBinding;
		} catch {
			// Try the next source, dist, or packaged-binary layout.
		}
	}
	return null;
}

export function loadNativeNoumenaWsV2BindingForTesting(): NativeNoumenaWsV2Binding | null {
	return loadNativeBinding();
}

export function candidateNativeNoumenaWsV2BindingModuleIdsForTesting(): string[] {
	return candidateNativeBindingModuleIds();
}

function wsUrlForChatCompletions(chatCompletionsUrl: string): string {
	const url = new URL(chatCompletionsUrl);
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	url.search = "";
	url.hash = "";
	const normalizedPath = url.pathname.replace(/\/+$/, "");
	url.pathname = normalizedPath.endsWith("/chat/completions")
		? `${normalizedPath}/ws/v2`
		: "/v1/chat/completions/ws/v2";
	return url.toString();
}

function headersJson(headers: Headers): string {
	const values: Record<string, string> = {};
	for (const [key, value] of headers.entries()) {
		values[key] = value;
	}
	return JSON.stringify(values);
}

function encodeSseFrame(data: string): Uint8Array {
	return new TextEncoder().encode(`data: ${data}\n\n`);
}

function createRequestId(): string {
	if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
		return `npi-ws-v2-${crypto.randomUUID()}`;
	}
	const bytes = new Uint8Array(16);
	if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
		crypto.getRandomValues(bytes);
	} else {
		for (let i = 0; i < bytes.length; i++) {
			bytes[i] = Math.floor(Math.random() * 256);
		}
	}
	const id = Array.from(bytes)
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
	return `npi-ws-v2-${id}`;
}

function isRequestNotification(message: Record<string, unknown>, requestId: string): boolean {
	const params = message.params;
	if (!isRecord(params)) return false;
	const id = params.id;
	return id === undefined || id === null || id === requestId;
}

function websocketOptionsJson(args: NoumenaOpenAICompatWsV2TransportArgs): string | null {
	const options: Record<string, number> = {};
	if (args.timeoutMs !== undefined && args.timeoutMs > 0) {
		options.readTimeoutMs = args.timeoutMs;
	}
	if (args.websocketConnectTimeoutMs !== undefined && args.websocketConnectTimeoutMs > 0) {
		options.connectTimeoutMs = args.websocketConnectTimeoutMs;
		options.initializeTimeoutMs = args.websocketConnectTimeoutMs;
	}
	return Object.keys(options).length > 0 ? JSON.stringify(options) : null;
}

export function createNativeNoumenaOpenAICompatWsV2Transport(
	binding: NativeNoumenaWsV2Binding | null = loadNativeBinding(),
): NoumenaOpenAICompatWsV2Transport | null {
	if (!binding?.wsV2Connect || !binding.wsV2Start || !binding.wsV2Next || !binding.wsV2Cancel || !binding.wsV2Close) {
		return null;
	}
	const wsV2Connect = binding.wsV2Connect;
	const wsV2Start = binding.wsV2Start;
	const wsV2Next = binding.wsV2Next;
	const wsV2Cancel = binding.wsV2Cancel;
	const wsV2Close = binding.wsV2Close;

	return async (args) => {
		const requestId = createRequestId();
		const sessionId = await wsV2Connect(
			wsUrlForChatCompletions(args.url),
			headersJson(args.headers),
			"npi-openai-compat",
			websocketOptionsJson(args),
		);

		let closed = false;
		const close = async () => {
			if (closed) return;
			closed = true;
			await wsV2Close(sessionId).catch(() => {});
		};

		let started = false;
		let startPromise: Promise<void> | null = null;
		let streamClosed = false;
		let abortHandler: (() => void) | null = null;
		let cancelled = false;

		const removeAbortHandler = () => {
			if (!abortHandler) return;
			args.signal?.removeEventListener("abort", abortHandler);
			abortHandler = null;
		};

		const safeCloseController = (controller: ReadableStreamDefaultController<Uint8Array>) => {
			if (streamClosed) return;
			streamClosed = true;
			try {
				controller.close();
			} catch {
				// The consumer may have cancelled while a native read was pending.
			}
		};

		const ensureStarted = () => {
			if (!startPromise) {
				startPromise = (async () => {
					if (started) return;
					started = true;
					await wsV2Start(sessionId, requestId, JSON.stringify(args.request));
				})();
			}
			return startPromise;
		};

		const cancelRequest = async () => {
			if (cancelled) return;
			cancelled = true;
			await wsV2Cancel(sessionId, requestId).catch(() => {});
		};

		const cancelAndClose = async () => {
			await cancelRequest();
			await close();
		};

		const stream = new ReadableStream<Uint8Array>(
			{
				start(controller) {
					abortHandler = () => {
						void cancelAndClose();
					};
					if (args.signal?.aborted) {
						abortHandler();
						safeCloseController(controller);
						return;
					}
					args.signal?.addEventListener("abort", abortHandler, { once: true });
				},
				async pull(controller) {
					if (streamClosed) return;
					try {
						await ensureStarted();
						while (!args.signal?.aborted) {
							const raw = await wsV2Next(sessionId);
							if (!raw) {
								throw new Error("WS v2 stream closed before completion");
							}
							const message = JSON.parse(raw) as unknown;
							if (!isRecord(message)) continue;
							if (message.id === requestId) {
								if ("error" in message) {
									throw new Error(`WS v2 request rejected: ${JSON.stringify(message.error)}`);
								}
								continue;
							}
							if (!isRequestNotification(message, requestId)) continue;
							const params = isRecord(message.params) ? message.params : {};
							if (message.method === "chat.completions.delta") {
								if (typeof params.data === "string") {
									controller.enqueue(encodeSseFrame(params.data));
									return;
								}
								continue;
							}
							if (message.method === "chat.completions.completed") {
								controller.enqueue(encodeSseFrame("[DONE]"));
								safeCloseController(controller);
								removeAbortHandler();
								await close();
								return;
							}
							if (message.method === "chat.completions.error") {
								throw new Error(`WS v2 stream error: ${JSON.stringify(params.error)}`);
							}
						}
						safeCloseController(controller);
						removeAbortHandler();
						await close();
					} catch (error) {
						streamClosed = true;
						removeAbortHandler();
						await close();
						controller.error(error);
					}
				},
				async cancel() {
					streamClosed = true;
					removeAbortHandler();
					await cancelRequest();
					await close();
				},
			},
			{
				highWaterMark: 0,
			},
		);

		return new Response(stream, {
			status: 200,
			headers: {
				"content-type": "text/event-stream",
				"request-id": requestId,
			},
		});
	};
}

function isRequest(value: unknown): value is Request {
	return typeof Request !== "undefined" && value instanceof Request;
}

function requestUrl(input: string | URL | Request): string {
	if (typeof input === "string") return input;
	if (input instanceof URL) return input.toString();
	return input.url;
}

function requestMethod(input: string | URL | Request, init?: RequestInit): string {
	return (init?.method ?? (isRequest(input) ? input.method : "GET")).toUpperCase();
}

function requestHeaders(input: string | URL | Request, init?: RequestInit): Headers {
	const headers = new Headers(isRequest(input) ? input.headers : undefined);
	if (init?.headers) {
		for (const [key, value] of new Headers(init.headers).entries()) {
			headers.set(key, value);
		}
	}
	return headers;
}

async function requestBodyText(input: string | URL | Request, init?: RequestInit): Promise<string | null> {
	if (init?.body !== undefined && init.body !== null) {
		if (typeof init.body === "string") return init.body;
		if (init.body instanceof Uint8Array) return new TextDecoder().decode(init.body);
		if (init.body instanceof ArrayBuffer) return new TextDecoder().decode(init.body);
		if (ArrayBuffer.isView(init.body)) {
			return new TextDecoder().decode(new Uint8Array(init.body.buffer, init.body.byteOffset, init.body.byteLength));
		}
		return null;
	}
	if (isRequest(input)) {
		return input.clone().text();
	}
	return null;
}

function isChatCompletionsRequest(url: string, method: string): boolean {
	if (method !== "POST") return false;
	try {
		return new URL(url).pathname.replace(/\/+$/, "").endsWith("/chat/completions");
	} catch {
		return false;
	}
}

async function parseFetchRequest(
	input: string | URL | Request,
	init?: RequestInit,
): Promise<ParsedFetchRequest | null> {
	const url = requestUrl(input);
	const method = requestMethod(input, init);
	if (!isChatCompletionsRequest(url, method)) return null;
	const bodyText = await requestBodyText(input, init);
	if (!bodyText) return null;
	const body = JSON.parse(bodyText) as unknown;
	if (!isRecord(body) || body.stream !== true) return null;
	return {
		body,
		headers: requestHeaders(input, init),
		signal: init?.signal ?? (isRequest(input) ? input.signal : undefined),
		url,
	};
}

export function createNoumenaOpenAICompatWsV2Fetch(
	fallbackFetch: FetchLike,
	options: NoumenaOpenAICompatWsV2FetchOptions = {},
	transportFactory: () => NoumenaOpenAICompatWsV2Transport | null = createNativeNoumenaOpenAICompatWsV2Transport,
): FetchLike {
	return async (input, init) => {
		if (options.transport === "sse") return fallbackFetch(input, init);
		let request: ParsedFetchRequest | null = null;
		try {
			request = await parseFetchRequest(input, init);
			if (!request) return fallbackFetch(input, init);
			const transport = transportFactory();
			if (!transport) return fallbackFetch(input, init);
			return await transport({
				url: request.url,
				headers: request.headers,
				request: request.body,
				signal: request.signal,
				timeoutMs: options.timeoutMs,
				websocketConnectTimeoutMs: options.websocketConnectTimeoutMs,
			});
		} catch {
			return fallbackFetch(input, init);
		}
	};
}
