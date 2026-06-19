export function areExperimentalFeaturesEnabled(): boolean {
	return process.env.NPI_EXPERIMENTAL === "1";
}
