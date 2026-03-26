import type { SchemaOverview } from '@directus/types';
import { toVersionName } from './to-version-name.js';

/**
 * Check whether a version table exists for the given collection.
 * True for versioned collections and junction tables with a version counterpart.
 */
export function hasVersionTable(schema: SchemaOverview, collection: string): boolean {
	return !!schema.collections[collection]?.versioning || !!schema.collections[toVersionName(collection)];
}
