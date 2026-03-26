import type { Field, RawField } from '@directus/types';
import { cloneDeep, unset } from 'lodash-es';
import { toVersionName } from './to-version-name.js';

/**
 * Transform a field payload for use on a version table. Versions collection/table
 * references, strips constraints and validation, and converts PKs to plain strings.
 *
 * Handles both real fields (schema) and alias fields (schema === null).
 *
 * @param opts.reference - Also version the field name itself, used when creating
 *   a duplicate reference field that points to a versioned target.
 */
export function toVersionField(payload: Field, opts?: { reference: boolean }): Field;
export function toVersionField(payload: RawField, opts?: { reference: boolean }): RawField;
export function toVersionField(payload: Field | RawField, opts?: { reference: boolean }): Field | RawField {
	const node = cloneDeep(payload);

	if (node.collection) node.collection = toVersionName(node.collection);

	if (opts?.reference) {
		node.field = toVersionName(node.field);
	}

	if (node.meta) {
		unset(node.meta, 'id');
		unset(node.meta, 'sort');

		if (node.meta.collection) node.meta.collection = toVersionName(node.meta.collection);
		if (opts?.reference && node.meta.field) node.meta.field = toVersionName(node.meta.field);

		// Remove "validation"
		node.meta.required = false;
		node.meta.validation = null;
		node.meta.validation_message = null;
		node.meta.conditions = null;
	}

	if (node.schema) {
		// Convert PK to plain string — version tables have their own auto-increment PK
		if (payload.schema?.is_primary_key || payload.schema?.has_auto_increment) {
			if (!node.meta) node.meta = {};

			node.schema.has_auto_increment = false;

			node.type = 'string';

			node.meta.interface = 'input';
		}

		if (node.schema.table) node.schema.table = toVersionName(node.schema.table);
		if (opts?.reference && node.schema.name) node.schema.name = toVersionName(node.schema.name);

		// Remove constraints — version fields are nullable, non-unique copies
		node.schema.is_nullable = true;
		node.schema.is_unique = false;
		node.schema.is_primary_key = false;
	}

	return node;
}
