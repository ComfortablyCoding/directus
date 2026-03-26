import { InvalidPayloadError } from '@directus/errors';
import type { Field, RawCollection, RawField } from '@directus/types';
import { cloneDeep } from 'lodash-es';
import type { Collection } from '../../types/collection.js';
import { systemVersionFields } from './constants.js';
import { toVersionField } from './to-version-field.js';
import { toVersionName } from './to-version-name.js';

/**
 * Transform a collection payload for use as a version table. Versions all name
 * references, disables versioning on the copy, hides it, and replaces fields
 * with system version fields plus versioned copies of real fields.
 *
 * Alias fields are skipped — relational aliases are created at relation sync time.
 */
export function toVersionCollection(payload: Collection): Collection;
export function toVersionCollection(payload: RawCollection): RawCollection;
export function toVersionCollection(payload: Collection | RawCollection): Collection | RawCollection {
	// don't allow creating version tables for folders
	if (payload.schema === null) {
		throw new InvalidPayloadError({ reason: 'Folders cannot be versioned' });
	}

	const node = cloneDeep(payload);

	node.collection = toVersionName(node.collection);

	if (node.meta) {
		if (node.meta.collection) node.meta.collection = toVersionName(node.meta.collection);

		// never allow versioning a version table :)
		node.meta.versioning = false;

		// auto hide similar to other "auto generated" tables
		node.meta.hidden = true;
	}

	if (node.schema) {
		if (node.schema.name) node.schema.name = toVersionName(node.schema.name);
	}

	// only accepted on create, will always at least contain `id`
	if ('fields' in node) {
		// inject "default" version fields
		const fields: Field[] | RawField[] = [...systemVersionFields];

		node.fields.forEach((field) => {
			// skip any alias fields, relational aliases will be created at relation time
			if (field.schema === null) return;

			fields.push(toVersionField(field));
		});

		node.fields = fields;
	}

	return node;
}
