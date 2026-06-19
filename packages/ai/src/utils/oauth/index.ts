/**
 * OAuth credential management for npi.
 *
 * npi ships Noumena OAuth as the only built-in OAuth provider. Extensions can
 * still register custom OAuth providers through the provider registry.
 */

export { loginNoumena, noumenaOAuthProvider, refreshNoumenaToken } from "./noumena.ts";
export * from "./types.ts";

import { noumenaOAuthProvider } from "./noumena.ts";
import type { OAuthCredentials, OAuthProviderId, OAuthProviderInfo, OAuthProviderInterface } from "./types.ts";

const BUILT_IN_OAUTH_PROVIDERS: OAuthProviderInterface[] = [noumenaOAuthProvider];

const oauthProviderRegistry = new Map<string, OAuthProviderInterface>(
	BUILT_IN_OAUTH_PROVIDERS.map((provider) => [provider.id, provider]),
);

export function getOAuthProvider(id: OAuthProviderId): OAuthProviderInterface | undefined {
	return oauthProviderRegistry.get(id);
}

export function registerOAuthProvider(provider: OAuthProviderInterface): void {
	oauthProviderRegistry.set(provider.id, provider);
}

export function unregisterOAuthProvider(id: string): void {
	const builtInProvider = BUILT_IN_OAUTH_PROVIDERS.find((provider) => provider.id === id);
	if (builtInProvider) {
		oauthProviderRegistry.set(id, builtInProvider);
		return;
	}
	oauthProviderRegistry.delete(id);
}

export function resetOAuthProviders(): void {
	oauthProviderRegistry.clear();
	for (const provider of BUILT_IN_OAUTH_PROVIDERS) {
		oauthProviderRegistry.set(provider.id, provider);
	}
}

export function getOAuthProviders(): OAuthProviderInterface[] {
	return Array.from(oauthProviderRegistry.values());
}

/** @deprecated Use getOAuthProviders() which returns OAuthProviderInterface[] */
export function getOAuthProviderInfoList(): OAuthProviderInfo[] {
	return getOAuthProviders().map((p) => ({
		id: p.id,
		name: p.name,
		available: true,
	}));
}

/** @deprecated Use getOAuthProvider(id).refreshToken() instead */
export async function refreshOAuthToken(
	providerId: OAuthProviderId,
	credentials: OAuthCredentials,
): Promise<OAuthCredentials> {
	const provider = getOAuthProvider(providerId);
	if (!provider) {
		throw new Error(`Unknown OAuth provider: ${providerId}`);
	}
	return provider.refreshToken(credentials);
}

export async function getOAuthApiKey(
	providerId: OAuthProviderId,
	credentials: Record<string, OAuthCredentials>,
): Promise<{ newCredentials: OAuthCredentials; apiKey: string } | null> {
	const provider = getOAuthProvider(providerId);
	if (!provider) {
		throw new Error(`Unknown OAuth provider: ${providerId}`);
	}

	let creds = credentials[providerId];
	if (!creds) {
		return null;
	}

	if (Date.now() >= creds.expires) {
		try {
			creds = await provider.refreshToken(creds);
		} catch {
			throw new Error(`Failed to refresh OAuth token for ${providerId}`);
		}
	}

	const apiKey = provider.getApiKey(creds);
	return { newCredentials: creds, apiKey };
}
