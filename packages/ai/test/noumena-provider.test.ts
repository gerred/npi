import { beforeEach, describe, expect, it, vi } from "vitest";
import { getModel } from "../src/models.ts";
import { streamOpenAICompletions } from "../src/providers/openai-completions.ts";
import type { Context, Model } from "../src/types.ts";
import { getOAuthProvider } from "../src/utils/oauth/index.ts";

const mockState = vi.hoisted(() => ({
	clientOptions: [] as unknown[],
	params: [] as unknown[],
}));

vi.mock("openai", () => {
	class FakeOpenAI {
		chat = {
			completions: {
				create: (params: unknown) => {
					mockState.params.push(params);
					const stream = {
						async *[Symbol.asyncIterator]() {
							yield {
								id: "chatcmpl-test",
								choices: [{ index: 0, delta: { content: "ok" } }],
							};
							yield {
								id: "chatcmpl-test",
								choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
							};
						},
					};
					const promise = Promise.resolve(stream) as Promise<typeof stream> & {
						withResponse: () => Promise<{
							data: typeof stream;
							response: { status: number; headers: Headers };
						}>;
					};
					promise.withResponse = async () => ({
						data: stream,
						response: { status: 200, headers: new Headers() },
					});
					return promise;
				},
			},
		};

		constructor(options: unknown) {
			mockState.clientOptions.push(options);
		}
	}
	return { default: FakeOpenAI };
});

interface OpenAIClientOptions {
	baseURL?: string;
	defaultHeaders?: Record<string, string>;
	fetch?: unknown;
}

interface NoumenaPayload {
	model?: string;
	max_tokens?: number;
	stream_options?: { include_usage?: boolean; continuous_usage_stats?: boolean };
	separate_reasoning?: boolean;
	stream_reasoning?: boolean;
	reasoning_effort?: string;
	chat_template_kwargs?: { thinking?: boolean; enable_thinking?: boolean };
}

const context: Context = {
	systemPrompt: "You are a helpful assistant.",
	messages: [{ role: "user", content: [{ type: "text", text: "hi" }], timestamp: 0 }],
	tools: [],
};

function getNoumenaModel(): Model<"openai-completions"> {
	return getModel("noumena", "kimi-2.7-coder") as Model<"openai-completions">;
}

describe("Noumena provider", () => {
	beforeEach(() => {
		mockState.clientOptions = [];
		mockState.params = [];
	});

	it("registers Noumena OAuth", () => {
		expect(getOAuthProvider("noumena")?.name).toBe("Noumena");
	});

	it("sends Kimi 2.7 Coder through Noumena's OpenAI-compatible route", async () => {
		const model = getNoumenaModel();
		expect(model.provider).toBe("noumena");
		expect(model.requestModel).toBe("/data/models/hf/moonshotai__Kimi-K2.7-Code");

		const stream = streamOpenAICompletions(model, context, {
			apiKey: "oauth-token",
			reasoningEffort: "high",
			maxTokens: 123,
		});
		for await (const _event of stream) {
			void _event;
		}

		const clientOptions = mockState.clientOptions[0] as OpenAIClientOptions;
		expect(clientOptions.baseURL).toBe("https://api.noumena.com/v1");
		expect(clientOptions.defaultHeaders).toMatchObject({
			"x-app": "cli",
			"anthropic-beta": "oauth-2025-04-20",
		});
		expect(typeof clientOptions.fetch).toBe("function");

		const payload = mockState.params[0] as NoumenaPayload;
		expect(payload.model).toBe("/data/models/hf/moonshotai__Kimi-K2.7-Code");
		expect(payload.max_tokens).toBe(123);
		expect(payload.stream_options).toEqual({ include_usage: true, continuous_usage_stats: false });
		expect(payload.separate_reasoning).toBe(true);
		expect(payload.stream_reasoning).toBe(true);
		expect(payload.reasoning_effort).toBe("high");
		expect(payload.chat_template_kwargs).toEqual({ thinking: true, enable_thinking: true });
	});

	it("does not install the Noumena WS v2 fetch hook when SSE is requested", async () => {
		const model = getNoumenaModel();

		const stream = streamOpenAICompletions(model, context, {
			apiKey: "oauth-token",
			transport: "sse",
		});
		for await (const _event of stream) {
			void _event;
		}

		const clientOptions = mockState.clientOptions[0] as OpenAIClientOptions;
		expect(clientOptions.fetch).toBeUndefined();
	});

	it("uses Noumena base URL overrides from request env", async () => {
		const model = getNoumenaModel();

		const stream = streamOpenAICompletions(model, context, {
			apiKey: "oauth-token",
			env: {
				NOUMENA_BASE_URL: "https://api.override.test",
			},
		});
		for await (const _event of stream) {
			void _event;
		}

		const clientOptions = mockState.clientOptions[0] as OpenAIClientOptions;
		expect(clientOptions.baseURL).toBe("https://api.override.test/v1");
	});

	it("prefers CODE_STREAM_BASE_URL over NOUMENA_BASE_URL", async () => {
		const model = getNoumenaModel();

		const stream = streamOpenAICompletions(model, context, {
			apiKey: "oauth-token",
			env: {
				NOUMENA_BASE_URL: "https://api.override.test",
				CODE_STREAM_BASE_URL: "https://stream.override.test/v1",
			},
		});
		for await (const _event of stream) {
			void _event;
		}

		const clientOptions = mockState.clientOptions[0] as OpenAIClientOptions;
		expect(clientOptions.baseURL).toBe("https://stream.override.test/v1");
	});
});
