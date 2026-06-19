import { afterEach, describe, expect, it, vi } from "vitest";
import {
	checkForNewNpiVersion,
	comparePackageVersions,
	getLatestNpiRelease,
	getLatestNpiVersion,
	isNewerPackageVersion,
} from "../src/utils/version-check.ts";

const originalSkipVersionCheck = process.env.NPI_SKIP_VERSION_CHECK;
const originalOffline = process.env.NPI_OFFLINE;

afterEach(() => {
	vi.unstubAllGlobals();
	if (originalSkipVersionCheck === undefined) {
		delete process.env.NPI_SKIP_VERSION_CHECK;
	} else {
		process.env.NPI_SKIP_VERSION_CHECK = originalSkipVersionCheck;
	}
	if (originalOffline === undefined) {
		delete process.env.NPI_OFFLINE;
	} else {
		process.env.NPI_OFFLINE = originalOffline;
	}
});

describe("version checks", () => {
	it("compares package versions", () => {
		expect(comparePackageVersions("0.70.6", "0.70.5")).toBeGreaterThan(0);
		expect(comparePackageVersions("0.70.5", "0.70.5")).toBe(0);
		expect(comparePackageVersions("0.70.4", "0.70.5")).toBeLessThan(0);
		expect(comparePackageVersions("5.0.0-beta.20", "5.0.0-beta.9")).toBeGreaterThan(0);
		expect(isNewerPackageVersion("0.70.5", "0.70.5")).toBe(false);
		expect(isNewerPackageVersion("0.70.6", "0.70.5")).toBe(true);
	});

	it("returns only newer versions", async () => {
		const fetchMock = vi.fn(async () => Response.json({ version: "1.2.3" }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(checkForNewNpiVersion("1.2.3")).resolves.toBeUndefined();
		await expect(checkForNewNpiVersion("1.2.2")).resolves.toEqual({ version: "1.2.3" });
	});

	it("uses npm registry metadata with an npi user agent", async () => {
		const fetchMock = vi.fn(async () => Response.json({ version: "1.2.4" }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(getLatestNpiVersion("1.2.3")).resolves.toBe("1.2.4");
		expect(fetchMock).toHaveBeenCalledWith(
			"https://registry.npmjs.org/%40gerred%2Fnpi-coding-agent/latest",
			expect.objectContaining({
				headers: expect.objectContaining({
					"User-Agent": expect.stringMatching(/^npi\/1\.2\.3 /),
					accept: "application/vnd.npm.install-v1+json, application/json",
				}),
			}),
		);
	});

	it("checks an explicit package name when provided", async () => {
		const fetchMock = vi.fn(async () =>
			Response.json({
				version: "1.2.4",
			}),
		);
		vi.stubGlobal("fetch", fetchMock);

		await expect(getLatestNpiRelease("1.2.3", { packageName: "@example/npi" })).resolves.toEqual({
			version: "1.2.4",
		});
		expect(fetchMock).toHaveBeenCalledWith("https://registry.npmjs.org/%40example%2Fnpi/latest", expect.any(Object));
	});

	it("returns update notes from npm metadata when present", async () => {
		const fetchMock = vi.fn(async () => Response.json({ note: " **Read this** ", version: "1.2.4" }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(getLatestNpiRelease("1.2.3")).resolves.toEqual({ note: "**Read this**", version: "1.2.4" });
	});

	it("skips npm registry calls when version checks are disabled", async () => {
		process.env.NPI_SKIP_VERSION_CHECK = "1";
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		await expect(getLatestNpiVersion("1.2.3")).resolves.toBeUndefined();
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
