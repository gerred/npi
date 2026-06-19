import { clearApiProviders, registerApiProvider } from "../api-registry.ts";
import { streamOpenAICompletions, streamSimpleOpenAICompletions } from "./openai-completions.ts";

export { streamOpenAICompletions, streamSimpleOpenAICompletions };

export function registerBuiltInApiProviders(): void {
	registerApiProvider({
		api: "openai-completions",
		stream: streamOpenAICompletions,
		streamSimple: streamSimpleOpenAICompletions,
	});
}

export function resetApiProviders(): void {
	clearApiProviders();
	registerBuiltInApiProviders();
}

registerBuiltInApiProviders();
