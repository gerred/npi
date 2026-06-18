import { describe, expect, it } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { defaultModelPerProvider, findInitialModel } from "../src/core/model-resolver.ts";

describe("Noumena provider", () => {
	it("uses Kimi 2.7 Coder as the Noumena login default", async () => {
		const authStorage = AuthStorage.inMemory({
			noumena: {
				type: "oauth",
				access: "oauth-token",
				refresh: "refresh-token",
				expires: Date.now() + 60_000,
			},
		});
		const registry = ModelRegistry.inMemory(authStorage);
		const model = registry.find("noumena", "kimi-2.7-coder");

		expect(defaultModelPerProvider.noumena).toBe("kimi-2.7-coder");
		expect(model).toBeDefined();
		expect(registry.getAvailable()).toContainEqual(
			expect.objectContaining({ provider: "noumena", id: "kimi-2.7-coder" }),
		);

		const auth = await registry.getApiKeyAndHeaders(model!);
		expect(auth).toEqual({
			ok: true,
			apiKey: "oauth-token",
			headers: {
				"x-app": "cli",
				"anthropic-beta": "oauth-2025-04-20",
			},
		});
	});

	it("selects Noumena Kimi before other configured providers", async () => {
		const authStorage = AuthStorage.inMemory({
			anthropic: {
				type: "api_key",
				key: "anthropic-key",
			},
			noumena: {
				type: "oauth",
				access: "oauth-token",
				refresh: "refresh-token",
				expires: Date.now() + 60_000,
			},
		});
		const registry = ModelRegistry.inMemory(authStorage);

		const result = await findInitialModel({
			scopedModels: [],
			isContinuing: false,
			modelRegistry: registry,
		});

		expect(result.model).toEqual(expect.objectContaining({ provider: "noumena", id: "kimi-2.7-coder" }));
	});
});
