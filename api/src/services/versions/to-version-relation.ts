import type { Relation } from '@directus/types';
import { cloneDeep, unset } from 'lodash-es';
import { systemVersionFields } from './constants.js';
import { toVersionName } from './to-version-name.js';

/**
 * Transform a relation payload for use on version tables. Detects the relation type
 * from the payload and versions the appropriate sides.
 *
 * - M2O / junction FK: versions the collection (many) side
 * - O2M: skips collection side — the FK table is not the versioned collection
 *
 * @param opts.reference - Also version the related (one) side, including field/column
 *   renames. Used when the target collection is also versioned.
 * @param opts.versionedCollections - List of versioned collection names. When provided,
 *   M2A one_allowed_collections is filtered to only include these collections
 *   (with both original + version name).
 */
export function toVersionRelation(
	payload: Partial<Relation>,
	opts?: { reference: boolean; versionedCollections?: string[] },
): Partial<Relation> {
	const node = cloneDeep(payload);

	// O2M: one_field set with no junction_field — collection side is NOT versioned.
	// In reference mode both sides are versioned, so O2M detection is skipped.
	const isO2M = !opts?.reference && !!node.meta?.one_field && !node.meta?.junction_field;

	// Version collection/many side (all types except O2M)
	if (!isO2M) {
		if (node.collection) node.collection = toVersionName(node.collection);

		if (node.schema) {
			if (node.schema.table) node.schema.table = toVersionName(node.schema.table);
		}

		if (node.meta) {
			if (node.meta.many_collection) node.meta.many_collection = toVersionName(node.meta.many_collection);
		}
	}

	// Version related/one side when target collection is versioned
	if (opts?.reference) {
		if (node.related_collection) node.related_collection = toVersionName(node.related_collection);

		if (!isO2M) {
			if (node.field) node.field = toVersionName(node.field);

			if (node.schema) {
				if (node.schema.column) node.schema.column = toVersionName(node.schema.column);
			}
		}

		if (node.schema) {
			if (node.schema.foreign_key_table) node.schema.foreign_key_table = toVersionName(node.schema.foreign_key_table);

			if (node.schema.foreign_key_column) {
				node.schema.foreign_key_column = systemVersionFields.find(
					(field) => field.schema?.is_primary_key === true,
				)!.field;
			}
		}

		if (node.meta) {
			if (!isO2M) {
				if (node.meta.many_field) node.meta.many_field = toVersionName(node.meta.many_field);
				if (node.meta.junction_field) node.meta.junction_field = toVersionName(node.meta.junction_field);
			}

			if (node.meta.one_collection) node.meta.one_collection = toVersionName(node.meta.one_collection);
			if (node.meta.one_field) node.meta.one_field = toVersionName(node.meta.one_field);
		}
	}

	if (node.meta) {
		// Always strip meta.id — version relations get their own ids
		unset(node.meta, 'id');

		// Filter M2A allowed collections to versioned targets, include both original + version name
		if (node.meta.one_allowed_collections && opts?.versionedCollections) {
			node.meta.one_allowed_collections = node.meta.one_allowed_collections.flatMap((c) =>
				opts.versionedCollections!.includes(c) ? [c, toVersionName(c)] : [],
			);
		}
	}

	return node;
}
