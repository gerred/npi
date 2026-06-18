#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = dirname(scriptDirectory);
const nativeDirectory = join(packageDirectory, "native", "openai-compat-ws-v2-napi");
const sourceDistDirectory = join(nativeDirectory, "dist");
const packageDistDirectory = join(packageDirectory, "dist", "native", "openai-compat-ws-v2-napi");
const nodeFileName = "openai-compat-ws-v2-napi.node";

function nativeLibraryName() {
	if (process.platform === "darwin") return "libopenai_compat_ws_v2_napi.dylib";
	if (process.platform === "linux") return "libopenai_compat_ws_v2_napi.so";
	if (process.platform === "win32") return "openai_compat_ws_v2_napi.dll";
	throw new Error(`Unsupported native WS v2 platform: ${process.platform}`);
}

function runCargoBuild() {
	const result = spawnSync("cargo", ["build", "--release", "--locked"], {
		cwd: nativeDirectory,
		stdio: "inherit",
	});
	if (result.status !== 0) {
		throw new Error("Failed to build Noumena OpenAI-compatible WS v2 native binding");
	}
}

function copyNativePackage() {
	const artifactPath = join(nativeDirectory, "target", "release", nativeLibraryName());
	if (!existsSync(artifactPath)) {
		throw new Error(`Expected native artifact does not exist: ${artifactPath}`);
	}

	mkdirSync(sourceDistDirectory, { recursive: true });
	copyFileSync(artifactPath, join(sourceDistDirectory, nodeFileName));

	rmSync(packageDistDirectory, { force: true, recursive: true });
	mkdirSync(packageDistDirectory, { recursive: true });
	copyFileSync(join(nativeDirectory, "index.js"), join(packageDistDirectory, "index.js"));
	copyFileSync(join(nativeDirectory, "index.d.ts"), join(packageDistDirectory, "index.d.ts"));
	copyFileSync(join(nativeDirectory, "package.json"), join(packageDistDirectory, "package.json"));
	copyFileSync(artifactPath, join(packageDistDirectory, nodeFileName));
}

runCargoBuild();
copyNativePackage();
