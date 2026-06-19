import { compare, valid } from "semver";
import { PACKAGE_NAME } from "../config.ts";
import { getPiUserAgent } from "./pi-user-agent.ts";

const NPM_REGISTRY_BASE_URL = "https://registry.npmjs.org";
const DEFAULT_VERSION_CHECK_TIMEOUT_MS = 10000;

export interface LatestNpiRelease {
	version: string;
	note?: string;
}

function getNpmLatestUrl(packageName: string): string {
	return `${NPM_REGISTRY_BASE_URL}/${encodeURIComponent(packageName)}/latest`;
}

function versionCheckDisabled(): boolean {
	return !!process.env.NPI_SKIP_VERSION_CHECK || !!process.env.NPI_OFFLINE;
}

export function comparePackageVersions(leftVersion: string, rightVersion: string): number | undefined {
	const left = valid(leftVersion.trim());
	const right = valid(rightVersion.trim());
	if (!left || !right) {
		return undefined;
	}
	return compare(left, right);
}

export function isNewerPackageVersion(candidateVersion: string, currentVersion: string): boolean {
	const comparison = comparePackageVersions(candidateVersion, currentVersion);
	if (comparison !== undefined) {
		return comparison > 0;
	}
	return candidateVersion.trim() !== currentVersion.trim();
}

export async function getLatestNpiRelease(
	currentVersion: string,
	options: { packageName?: string; timeoutMs?: number } = {},
): Promise<LatestNpiRelease | undefined> {
	if (versionCheckDisabled()) return undefined;

	const response = await fetch(getNpmLatestUrl(options.packageName ?? PACKAGE_NAME), {
		headers: {
			"User-Agent": getPiUserAgent(currentVersion),
			accept: "application/vnd.npm.install-v1+json, application/json",
		},
		signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_VERSION_CHECK_TIMEOUT_MS),
	});
	if (!response.ok) return undefined;

	const data = (await response.json()) as {
		version?: unknown;
		note?: unknown;
	};
	if (typeof data.version !== "string" || !data.version.trim()) {
		return undefined;
	}
	const note = typeof data.note === "string" && data.note.trim() ? data.note.trim() : undefined;
	return {
		version: data.version.trim(),
		...(note ? { note } : {}),
	};
}

export async function getLatestNpiVersion(
	currentVersion: string,
	options: { packageName?: string; timeoutMs?: number } = {},
): Promise<string | undefined> {
	return (await getLatestNpiRelease(currentVersion, options))?.version;
}

export async function checkForNewNpiVersion(currentVersion: string): Promise<LatestNpiRelease | undefined> {
	try {
		const latestRelease = await getLatestNpiRelease(currentVersion);
		if (latestRelease && isNewerPackageVersion(latestRelease.version, currentVersion)) {
			return latestRelease;
		}
		return undefined;
	} catch {
		return undefined;
	}
}
