import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findEnvKeys, getEnvApiKey } from "../src/env-api-keys.ts";

const originalCopilotGitHubToken = process.env.COPILOT_GITHUB_TOKEN;
const originalGhToken = process.env.GH_TOKEN;
const originalGitHubToken = process.env.GITHUB_TOKEN;
const originalNoumenaApiKey = process.env.NOUMENA_API_KEY;
const originalNoumenaApiKeyFile = process.env.NOUMENA_API_KEY_FILE;

let tempDirs: string[] = [];

afterEach(() => {
	if (originalCopilotGitHubToken === undefined) {
		delete process.env.COPILOT_GITHUB_TOKEN;
	} else {
		process.env.COPILOT_GITHUB_TOKEN = originalCopilotGitHubToken;
	}

	if (originalGhToken === undefined) {
		delete process.env.GH_TOKEN;
	} else {
		process.env.GH_TOKEN = originalGhToken;
	}

	if (originalGitHubToken === undefined) {
		delete process.env.GITHUB_TOKEN;
	} else {
		process.env.GITHUB_TOKEN = originalGitHubToken;
	}

	if (originalNoumenaApiKey === undefined) {
		delete process.env.NOUMENA_API_KEY;
	} else {
		process.env.NOUMENA_API_KEY = originalNoumenaApiKey;
	}

	if (originalNoumenaApiKeyFile === undefined) {
		delete process.env.NOUMENA_API_KEY_FILE;
	} else {
		process.env.NOUMENA_API_KEY_FILE = originalNoumenaApiKeyFile;
	}

	for (const tempDir of tempDirs) {
		rmSync(tempDir, { recursive: true, force: true });
	}
	tempDirs = [];
});

describe("environment API keys", () => {
	it("does not treat generic GitHub tokens as GitHub Copilot credentials", () => {
		delete process.env.COPILOT_GITHUB_TOKEN;
		process.env.GH_TOKEN = "gh-token";
		process.env.GITHUB_TOKEN = "github-token";

		expect(findEnvKeys("github-copilot")).toBeUndefined();
		expect(getEnvApiKey("github-copilot")).toBeUndefined();
	});

	it("does not expose GitHub Copilot credentials as built-in npi credentials", () => {
		process.env.COPILOT_GITHUB_TOKEN = "copilot-token";
		process.env.GH_TOKEN = "gh-token";
		process.env.GITHUB_TOKEN = "github-token";

		expect(findEnvKeys("github-copilot")).toBeUndefined();
		expect(getEnvApiKey("github-copilot")).toBeUndefined();
	});

	it("resolves Noumena credentials from NOUMENA_API_KEY", () => {
		process.env.NOUMENA_API_KEY = "noumena-token";

		expect(findEnvKeys("noumena")).toEqual(["NOUMENA_API_KEY"]);
		expect(getEnvApiKey("noumena")).toBe("noumena-token");
	});

	it("resolves Noumena credentials from NOUMENA_API_KEY_FILE", () => {
		delete process.env.NOUMENA_API_KEY;
		const tempDir = mkdtempSync(join(tmpdir(), "pi-noumena-key-"));
		tempDirs.push(tempDir);
		const apiKeyFile = join(tempDir, "api_key");
		writeFileSync(apiKeyFile, "noumena-file-token\n", "utf-8");
		process.env.NOUMENA_API_KEY_FILE = apiKeyFile;

		expect(findEnvKeys("noumena")).toEqual(["NOUMENA_API_KEY_FILE"]);
		expect(getEnvApiKey("noumena")).toBe("noumena-file-token");
	});
});
