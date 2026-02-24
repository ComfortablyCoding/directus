export function toVersionedCollectionName(collection: string): string {
	// TODO: rename to `directus_versions_${collection}` once shadow tables are supported
	return `shadow_${collection}`;
}
