import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Api, Context, Model, OpenAICompletionsCompat } from "@gerred/npi-ai";
import { getApiProvider } from "@gerred/npi-ai";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { clearApiKeyCache, ModelRegistry } from "../src/core/model-registry.ts";

const NOUMENA_PROVIDER = "noumena";
const KIMI_MODEL = "kimi-2.7-coder";

describe("ModelRegistry", () => {
	let tempDir: string;
	let modelsJsonPath: string;
	let authStorage: AuthStorage;

	beforeEach(() => {
		tempDir = join(tmpdir(), `npi-test-model-registry-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
		modelsJsonPath = join(tempDir, "models.json");
		authStorage = AuthStorage.create(join(tempDir, "auth.json"));
	});

	afterEach(() => {
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true });
		}
		clearApiKeyCache();
		vi.restoreAllMocks();
	});

	function writeModelsJson(providers: Record<string, unknown>) {
		writeFileSync(modelsJsonPath, JSON.stringify({ providers }));
	}

	function getModelsForProvider(registry: ModelRegistry, provider: string) {
		return registry.getAll().filter((model) => model.provider === provider);
	}

	function getKimi(registry: ModelRegistry): Model<Api> {
		const model = registry.find(NOUMENA_PROVIDER, KIMI_MODEL);
		if (!model) {
			throw new Error("Expected built-in Noumena Kimi model");
		}
		return model;
	}

	function toShPath(value: string): string {
		return value.replace(/\\/g, "/").replace(/"/g, '\\"');
	}

	describe("built-in Noumena models", () => {
		test("loads only the Noumena provider", () => {
			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			const providers = [...new Set(registry.getAll().map((model) => model.provider))];

			expect(registry.getError()).toBeUndefined();
			expect(providers).toEqual([NOUMENA_PROVIDER]);
			expect(getKimi(registry).api).toBe("openai-completions");
		});

		test("provider display name resolves Noumena and falls back for unknown names", () => {
			const registry = ModelRegistry.create(authStorage, modelsJsonPath);

			expect(registry.getProviderDisplayName(NOUMENA_PROVIDER)).toBe("Noumena");
			expect(registry.getProviderDisplayName("unknown-provider")).toBe("unknown-provider");
		});
	});

	describe("models.json overrides", () => {
		test("overriding Noumena baseUrl keeps built-in models", () => {
			writeModelsJson({
				noumena: { baseUrl: "https://proxy.example.com/v1" },
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			const models = getModelsForProvider(registry, NOUMENA_PROVIDER);

			expect(registry.getError()).toBeUndefined();
			expect(models.length).toBeGreaterThan(0);
			expect(models.every((model) => model.baseUrl === "https://proxy.example.com/v1")).toBe(true);
		});

		test("headers-only override resolves at request time", async () => {
			authStorage.setRuntimeApiKey(NOUMENA_PROVIDER, "test-key");
			writeModelsJson({
				noumena: {
					headers: {
						"X-Custom-Header": "custom-value",
					},
				},
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			const auth = await registry.getApiKeyAndHeaders(getKimi(registry));

			expect(auth).toMatchObject({
				ok: true,
				apiKey: "test-key",
				headers: expect.objectContaining({ "X-Custom-Header": "custom-value" }),
			});
		});

		test("provider-level compat applies to built-in Noumena models", () => {
			writeModelsJson({
				noumena: {
					compat: {
						supportsUsageInStreaming: false,
						supportsStrictMode: false,
					},
				},
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			const compat = getKimi(registry).compat as OpenAICompletionsCompat | undefined;

			expect(registry.getError()).toBeUndefined();
			expect(compat?.supportsUsageInStreaming).toBe(false);
			expect(compat?.supportsStrictMode).toBe(false);
		});

		test("model override deep merges cost and compat fields", () => {
			writeModelsJson({
				noumena: {
					modelOverrides: {
						[KIMI_MODEL]: {
							name: "Noumena Kimi Override",
							cost: { input: 99 },
							compat: { supportsStrictMode: false },
						},
					},
				},
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			const model = getKimi(registry);
			const compat = model.compat as OpenAICompletionsCompat | undefined;

			expect(model.name).toBe("Noumena Kimi Override");
			expect(model.cost.input).toBe(99);
			expect(model.cost.output).toBe(0);
			expect(compat?.supportsStrictMode).toBe(false);
		});

		test("model override adds request headers", async () => {
			authStorage.setRuntimeApiKey(NOUMENA_PROVIDER, "test-key");
			writeModelsJson({
				noumena: {
					modelOverrides: {
						[KIMI_MODEL]: {
							headers: { "X-Model-Header": "value" },
						},
					},
				},
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			const auth = await registry.getApiKeyAndHeaders(getKimi(registry));

			expect(auth).toMatchObject({
				ok: true,
				apiKey: "test-key",
				headers: expect.objectContaining({ "X-Model-Header": "value" }),
			});
		});

		test("invalid provider config reports an error and keeps built-in models", () => {
			writeModelsJson({
				noumena: {},
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);

			expect(registry.getError()).toContain('Provider noumena: must specify "baseUrl"');
			expect(getKimi(registry)).toBeDefined();
		});

		test("refresh picks up override changes", () => {
			writeModelsJson({
				noumena: { baseUrl: "https://first-proxy.example.com/v1" },
			});
			const registry = ModelRegistry.create(authStorage, modelsJsonPath);

			expect(getKimi(registry).baseUrl).toBe("https://first-proxy.example.com/v1");

			writeModelsJson({
				noumena: { baseUrl: "https://second-proxy.example.com/v1" },
			});
			registry.refresh();

			expect(getKimi(registry).baseUrl).toBe("https://second-proxy.example.com/v1");
		});
	});

	describe("request auth resolution", () => {
		test("apiKey with ! prefix executes command and uses stdout", async () => {
			writeModelsJson({
				noumena: {
					baseUrl: "https://api.noumena.com/v1",
					apiKey: "!echo test-api-key-from-command",
				},
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);

			expect(await registry.getApiKeyForProvider(NOUMENA_PROVIDER)).toBe("test-api-key-from-command");
		});

		test("apiKey with $ prefix resolves to env value", async () => {
			const originalEnv = process.env.TEST_NOUMENA_API_KEY_12345;
			process.env.TEST_NOUMENA_API_KEY_12345 = "env-api-key-value";

			try {
				writeModelsJson({
					noumena: {
						baseUrl: "https://api.noumena.com/v1",
						apiKey: "$TEST_NOUMENA_API_KEY_12345",
					},
				});

				const registry = ModelRegistry.create(authStorage, modelsJsonPath);

				expect(await registry.getApiKeyForProvider(NOUMENA_PROVIDER)).toBe("env-api-key-value");
			} finally {
				if (originalEnv === undefined) {
					delete process.env.TEST_NOUMENA_API_KEY_12345;
				} else {
					process.env.TEST_NOUMENA_API_KEY_12345 = originalEnv;
				}
			}
		});

		test("provider auth status reports command apiKey without executing it", () => {
			const counterFile = join(tempDir, "status-counter");
			writeFileSync(counterFile, "0");
			const counterPath = toShPath(counterFile);
			const command = `!sh -c 'echo 1 > "${counterPath}"; echo key-value'`;
			writeModelsJson({
				noumena: {
					baseUrl: "https://api.noumena.com/v1",
					apiKey: command,
				},
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);

			expect(registry.getProviderAuthStatus(NOUMENA_PROVIDER)).toEqual({
				configured: true,
				source: "models_json_command",
			});
			expect(readFileSync(counterFile, "utf-8")).toBe("0");
		});

		test("getAvailable does not execute command-backed apiKey resolution", () => {
			const counterFile = join(tempDir, "available-counter");
			writeFileSync(counterFile, "0");
			const counterPath = toShPath(counterFile);
			const command = `!sh -c 'count=$(cat "${counterPath}"); echo $((count + 1)) > "${counterPath}"; echo key-value'`;
			writeModelsJson({
				noumena: {
					baseUrl: "https://api.noumena.com/v1",
					apiKey: command,
				},
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);

			expect(registry.getAvailable().some((model) => model.provider === NOUMENA_PROVIDER)).toBe(true);
			expect(readFileSync(counterFile, "utf-8").trim()).toBe("0");
		});

		test("authHeader resolves on every request", async () => {
			const tokenFile = join(tempDir, "token");
			writeFileSync(tokenFile, "token-1");
			const tokenPath = toShPath(tokenFile);

			writeModelsJson({
				noumena: {
					baseUrl: "https://api.noumena.com/v1",
					apiKey: `!sh -c 'cat "${tokenPath}"'`,
					authHeader: true,
				},
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			const model = getKimi(registry);

			expect(await registry.getApiKeyAndHeaders(model)).toMatchObject({
				ok: true,
				apiKey: "token-1",
				headers: expect.objectContaining({ Authorization: "Bearer token-1" }),
			});

			writeFileSync(tokenFile, "token-2");

			expect(await registry.getApiKeyAndHeaders(model)).toMatchObject({
				ok: true,
				apiKey: "token-2",
				headers: expect.objectContaining({ Authorization: "Bearer token-2" }),
			});
		});
	});

	describe("dynamic provider lifecycle", () => {
		test("registerProvider can override Noumena baseUrl and refresh preserves it", () => {
			const registry = ModelRegistry.create(authStorage, modelsJsonPath);

			registry.registerProvider(NOUMENA_PROVIDER, { baseUrl: "https://proxy.test/noumena" });
			registry.refresh();

			const models = getModelsForProvider(registry, NOUMENA_PROVIDER);
			expect(models.length).toBeGreaterThan(0);
			expect(models.every((model) => model.baseUrl === "https://proxy.test/noumena")).toBe(true);
		});

		test("failed registerProvider does not persist invalid streamSimple config", () => {
			const registry = ModelRegistry.create(authStorage, modelsJsonPath);

			expect(() =>
				registry.registerProvider("broken-provider", {
					streamSimple: () => {
						throw new Error("should not run");
					},
				}),
			).toThrow('Provider broken-provider: "api" is required when registering streamSimple.');

			expect(() => registry.refresh()).not.toThrow();
		});

		test("unregisterProvider removes a custom streamSimple override", () => {
			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			const model: Model<Api> = {
				id: "test-openai-model",
				name: "Test OpenAI Model",
				api: "openai-completions",
				provider: NOUMENA_PROVIDER,
				baseUrl: "https://api.noumena.com/v1",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000,
				maxTokens: 4096,
			};
			const emptyContext: Context = { messages: [] };

			registry.registerProvider("stream-override-provider", {
				api: "openai-completions",
				streamSimple: () => {
					throw new Error("custom streamSimple override");
				},
			});

			expect(() => getApiProvider("openai-completions")?.streamSimple(model, emptyContext)).toThrow(
				"custom streamSimple override",
			);

			registry.unregisterProvider("stream-override-provider");

			expect(() => getApiProvider("openai-completions")?.streamSimple(model, emptyContext)).not.toThrow(
				"custom streamSimple override",
			);
		});
	});
});
