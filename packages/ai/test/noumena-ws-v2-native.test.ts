import { describe, expect, it, vi } from "vitest";
import {
	createNativeNoumenaOpenAICompatWsV2Transport,
	createNoumenaOpenAICompatWsV2Fetch,
	type NativeNoumenaWsV2Binding,
	shouldUseNoumenaOpenAICompatWsV2,
} from "../src/providers/noumena-ws-v2-native.ts";

describe("Noumena OpenAI-compatible WS v2 native transport", () => {
	it("converts native WS v2 notifications into SSE frames", async () => {
		let requestId = "";
		const binding: NativeNoumenaWsV2Binding = {
			wsV2NativeAvailable: () => true,
			wsV2Connect: vi.fn(async () => "session-1"),
			wsV2Start: vi.fn(async (_sessionId, nextRequestId) => {
				requestId = nextRequestId;
			}),
			wsV2Next: vi
				.fn()
				.mockImplementationOnce(async () => JSON.stringify({ id: requestId, result: {} }))
				.mockImplementationOnce(async () =>
					JSON.stringify({
						method: "chat.completions.delta",
						params: {
							id: requestId,
							data: '{"id":"chatcmpl-test","choices":[{"index":0,"delta":{"content":"ok"}}]}',
						},
					}),
				)
				.mockImplementationOnce(async () =>
					JSON.stringify({
						method: "chat.completions.completed",
						params: { id: requestId },
					}),
				),
			wsV2Cancel: vi.fn(async () => {}),
			wsV2Close: vi.fn(async () => {}),
		};

		const transport = createNativeNoumenaOpenAICompatWsV2Transport(binding);
		if (!transport) throw new Error("Expected transport");

		const response = await transport({
			url: "https://api.noumena.com/v1/chat/completions",
			headers: new Headers({ authorization: "Bearer token" }),
			request: { model: "kimi-2.7-coder", stream: true },
			timeoutMs: 1234,
			websocketConnectTimeoutMs: 5678,
		});

		await expect(response.text()).resolves.toBe(
			'data: {"id":"chatcmpl-test","choices":[{"index":0,"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n',
		);
		expect(binding.wsV2Connect).toHaveBeenCalledWith(
			"wss://api.noumena.com/v1/chat/completions/ws/v2",
			JSON.stringify({ authorization: "Bearer token" }),
			"npi-openai-compat",
			JSON.stringify({
				readTimeoutMs: 1234,
				connectTimeoutMs: 5678,
				initializeTimeoutMs: 5678,
			}),
		);
		expect(binding.wsV2Start).toHaveBeenCalledWith(
			"session-1",
			requestId,
			JSON.stringify({ model: "kimi-2.7-coder", stream: true }),
		);
		expect(binding.wsV2Close).toHaveBeenCalledWith("session-1");
	});

	it("falls back to the provided fetch when the native transport is unavailable", async () => {
		const fallbackFetch = vi.fn(async () => new Response("fallback"));
		const fetch = createNoumenaOpenAICompatWsV2Fetch(fallbackFetch, {}, () => null);

		const response = await fetch("https://api.noumena.com/v1/chat/completions", {
			method: "POST",
			body: JSON.stringify({ model: "kimi-2.7-coder", stream: true }),
		});

		await expect(response.text()).resolves.toBe("fallback");
		expect(fallbackFetch).toHaveBeenCalledOnce();
	});

	it("uses WS v2 by default for Noumena and allows env or SSE opt-out", () => {
		const originalNpiFlag = process.env.NPI_OPENAI_COMPAT_WS_V2;
		const originalNcodeFlag = process.env.NCODE_OPENAI_COMPAT_WS_V2;
		delete process.env.NPI_OPENAI_COMPAT_WS_V2;
		delete process.env.NCODE_OPENAI_COMPAT_WS_V2;
		try {
			expect(
				shouldUseNoumenaOpenAICompatWsV2({
					baseUrl: "https://api.noumena.com/v1",
					provider: "noumena",
				}),
			).toBe(true);
			expect(
				shouldUseNoumenaOpenAICompatWsV2({
					baseUrl: "https://api.noumena.com/v1",
					provider: "noumena",
					transport: "sse",
				}),
			).toBe(false);
			expect(
				shouldUseNoumenaOpenAICompatWsV2({
					baseUrl: "https://api.noumena.com/v1",
					env: { NPI_OPENAI_COMPAT_WS_V2: "false" },
					provider: "noumena",
				}),
			).toBe(false);
			expect(
				shouldUseNoumenaOpenAICompatWsV2({
					baseUrl: "https://api.noumena.com/v1",
					env: { NCODE_OPENAI_COMPAT_WS_V2: "true" },
					provider: "noumena",
				}),
			).toBe(true);
		} finally {
			if (originalNpiFlag === undefined) {
				delete process.env.NPI_OPENAI_COMPAT_WS_V2;
			} else {
				process.env.NPI_OPENAI_COMPAT_WS_V2 = originalNpiFlag;
			}
			if (originalNcodeFlag === undefined) {
				delete process.env.NCODE_OPENAI_COMPAT_WS_V2;
			} else {
				process.env.NCODE_OPENAI_COMPAT_WS_V2 = originalNcodeFlag;
			}
		}
	});
});
