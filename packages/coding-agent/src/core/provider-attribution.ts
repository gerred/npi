import type { Api, Model } from "@gerred/npi-ai";
import type { SettingsManager } from "./settings-manager.ts";

export function mergeProviderAttributionHeaders(
	_model: Model<Api>,
	_settingsManager: SettingsManager,
	_sessionId: string | undefined,
	...headerSources: Array<Record<string, string> | undefined>
): Record<string, string> | undefined {
	const merged: Record<string, string> = {};

	for (const headers of headerSources) {
		if (headers) {
			Object.assign(merged, headers);
		}
	}

	return Object.keys(merged).length > 0 ? merged : undefined;
}
