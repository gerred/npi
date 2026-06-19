// NEVER convert to top-level imports - breaks browser/Vite builds
let _existsSync: typeof import("node:fs").existsSync | null = null;
let _readFileSync: typeof import("node:fs").readFileSync | null = null;

type DynamicImport = (specifier: string) => Promise<unknown>;

const dynamicImport: DynamicImport = (specifier) => import(specifier);
const NODE_FS_SPECIFIER = "node:" + "fs";

// Eagerly load in Node.js/Bun environment only
if (typeof process !== "undefined" && (process.versions?.node || process.versions?.bun)) {
	dynamicImport(NODE_FS_SPECIFIER).then((m) => {
		const fsModule = m as typeof import("node:fs");
		_existsSync = fsModule.existsSync;
		_readFileSync = fsModule.readFileSync;
	});
}

import type { KnownProvider, ProviderEnv } from "./types.ts";
import { getProviderEnvValue } from "./utils/provider-env.ts";

function readFileIfAvailable(path: string): string | undefined {
	try {
		if (_existsSync && _readFileSync) {
			if (!_existsSync(path)) return undefined;
			return _readFileSync(path, "utf-8");
		}

		const getBuiltinModule = process.getBuiltinModule as ((specifier: string) => unknown) | undefined;
		const fsModule = getBuiltinModule?.("node:fs") as
			| {
					existsSync: (path: string) => boolean;
					readFileSync: (path: string, encoding: "utf-8") => string;
			  }
			| undefined;
		if (!fsModule?.existsSync(path)) return undefined;
		return fsModule.readFileSync(path, "utf-8");
	} catch {
		return undefined;
	}
}

function getNoumenaApiKeyFromFile(env?: ProviderEnv): string | undefined {
	const path = getProviderEnvValue("NOUMENA_API_KEY_FILE", env);
	if (!path) return undefined;

	const apiKey = readFileIfAvailable(path)?.trim();
	return apiKey || undefined;
}

function getApiKeyEnvVars(provider: string): readonly string[] | undefined {
	return provider === "noumena" ? ["NOUMENA_API_KEY"] : undefined;
}

/**
 * Find configured environment variables that can provide an API key for a provider.
 *
 * This only reports actual API key variables. It intentionally excludes ambient
 * credential sources such as AWS profiles, AWS IAM credentials, and Google
 * Application Default Credentials.
 */
export function findEnvKeys(provider: KnownProvider, env?: ProviderEnv): string[] | undefined;
export function findEnvKeys(provider: string, env?: ProviderEnv): string[] | undefined;
export function findEnvKeys(provider: string, env?: ProviderEnv): string[] | undefined {
	const envVars = getApiKeyEnvVars(provider);
	if (!envVars) return undefined;

	const found = envVars.filter((envVar) => !!getProviderEnvValue(envVar, env));
	if (found.length > 0) return found;
	if (provider === "noumena" && getNoumenaApiKeyFromFile(env)) {
		return ["NOUMENA_API_KEY_FILE"];
	}
	return undefined;
}

/**
 * Get API key for provider from known environment variables, e.g. OPENAI_API_KEY.
 *
 * Will not return API keys for providers that require OAuth tokens.
 */
export function getEnvApiKey(provider: KnownProvider, env?: ProviderEnv): string | undefined;
export function getEnvApiKey(provider: string, env?: ProviderEnv): string | undefined;
export function getEnvApiKey(provider: string, env?: ProviderEnv): string | undefined {
	const envKeys = findEnvKeys(provider, env);
	if (envKeys?.[0]) {
		if (envKeys[0] === "NOUMENA_API_KEY_FILE") {
			return getNoumenaApiKeyFromFile(env);
		}
		return getProviderEnvValue(envKeys[0], env);
	}

	return undefined;
}
