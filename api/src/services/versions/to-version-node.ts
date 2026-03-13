import { cloneDeep } from 'lodash-es';
import type { M2ONode } from '../../types/ast.js';
import { VERSION_SYSTEM_FIELDS } from './constants.js';
import { toVersionedCollectionName } from './to-version-collection-name.js';
import { toVersionedRelationName } from './to-versioned-relation-name.js';

/**
 * Adjusts an AST nodes relevant collection and relation names to their
 * versioned equivalents.
 *
 * @param node - The source AST node to transform.
 * @returns A node with versioned collection/relation names applied.
 */
export function toVersionNode<T extends M2ONode>(node: T): T {
	const child = cloneDeep(node);

	if (child.type === 'm2o') {
		child.fieldKey = toVersionedRelationName(child.fieldKey);
		child.name = toVersionedRelationName(child.name);
		child.relation.related_collection = toVersionedCollectionName(child.relation.related_collection!);
		child.relation.field = toVersionedRelationName(child.relation.field);

		if (child.relation.schema) {
			child.relation.schema.foreign_key_table &&= toVersionedCollectionName(child.relation.schema?.foreign_key_table);
			child.relation.schema.foreign_key_column &&= VERSION_SYSTEM_FIELDS.primary.field;
		}

		if (child.relation.meta) {
			child.relation.meta.many_field &&= toVersionedRelationName(child.relation.meta.many_field);
			child.relation.meta.one_collection &&= toVersionedCollectionName(child.relation.meta.one_collection);
		}
	}

	return child;
}
