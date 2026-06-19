import { IMAGE_MODELS } from "./image-models.generated.ts";
import type { ImagesApi, ImagesModel, ImagesProvider, KnownImagesProvider } from "./types.ts";

const imageModelRegistry: Map<string, Map<string, ImagesModel<ImagesApi>>> = new Map();
const generatedImageModels = IMAGE_MODELS as Record<string, Record<string, ImagesModel<ImagesApi>>>;

for (const [provider, models] of Object.entries(generatedImageModels)) {
	const providerModels = new Map<string, ImagesModel<ImagesApi>>();
	for (const [id, model] of Object.entries(models)) {
		providerModels.set(id, model);
	}
	imageModelRegistry.set(provider, providerModels);
}

export function getImageModel(provider: ImagesProvider, modelId: string): ImagesModel<ImagesApi> {
	const providerModels = imageModelRegistry.get(provider);
	return providerModels?.get(modelId) as ImagesModel<ImagesApi>;
}

export function getImageProviders(): KnownImagesProvider[] {
	return Array.from(imageModelRegistry.keys()) as KnownImagesProvider[];
}

export function getImageModels(provider: ImagesProvider): ImagesModel<ImagesApi>[] {
	const models = imageModelRegistry.get(provider);
	return models ? Array.from(models.values()) : [];
}
