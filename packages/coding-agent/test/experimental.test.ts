import { afterEach, describe, expect, it } from "vitest";
import { areExperimentalFeaturesEnabled } from "../src/core/experimental.ts";

describe("areExperimentalFeaturesEnabled", () => {
	const originalNpiExperimental = process.env.NPI_EXPERIMENTAL;

	afterEach(() => {
		if (originalNpiExperimental === undefined) {
			delete process.env.NPI_EXPERIMENTAL;
		} else {
			process.env.NPI_EXPERIMENTAL = originalNpiExperimental;
		}
	});

	it("returns false when NPI_EXPERIMENTAL is unset", () => {
		delete process.env.NPI_EXPERIMENTAL;

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});

	it("returns false when NPI_EXPERIMENTAL is empty", () => {
		process.env.NPI_EXPERIMENTAL = "";

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});

	it("returns true when NPI_EXPERIMENTAL is set to 1", () => {
		process.env.NPI_EXPERIMENTAL = "1";

		expect(areExperimentalFeaturesEnabled()).toBe(true);
	});

	it("returns false when NPI_EXPERIMENTAL is set to 0", () => {
		process.env.NPI_EXPERIMENTAL = "0";

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});

	it("returns false when NPI_EXPERIMENTAL is set to a non-1 value", () => {
		process.env.NPI_EXPERIMENTAL = "true";

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});
});
