import { describe, expect, it } from "vitest";
import { oauthSuccessHtml } from "../src/utils/oauth/oauth-page.ts";

describe("OAuth callback page", () => {
	it("uses the Noumena wordmark", () => {
		const html = oauthSuccessHtml("Done");

		expect(html).toContain('src="https://code.noumena.com/logos/wordmark-light.svg"');
		expect(html).toContain('alt="Noumena"');
		expect(html).not.toContain("<svg");
	});
});
