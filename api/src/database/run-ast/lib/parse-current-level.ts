import type { Query, SchemaOverview } from '@directus/types';
import { VERSION_SYSTEM_FIELDS } from '../../../services/versions/constants.js';
import type { FieldNode, FunctionFieldNode, NestedCollectionNode } from '../../../types/ast.js';
import { parseFilterKey } from '../../../utils/parse-filter-key.js';
import { parseJsonFunction } from '../../helpers/fn/json/parse-function.js';

export async function parseCurrentLevel(
	schema: SchemaOverview,
	collection: string,
	children: (NestedCollectionNode | FieldNode | FunctionFieldNode)[],
	query: Query,
) {
	const primaryKeyField = schema.collections[collection]!.primary;
	const columnsInCollection = Object.keys(schema.collections[collection]!.fields);

	const columnsToSelectInternal: string[] = [];
	const nestedCollectionNodes: NestedCollectionNode[] = [];

	for (const child of children) {
		if (child.type === 'field' || child.type === 'functionField') {
			let fieldName;

			if (child.type == 'functionField' && child.name.startsWith('json')) {
				fieldName = parseJsonFunction(child.name).field;
			} else {
				fieldName = parseFilterKey(child.name).fieldName;
			}

			if (columnsInCollection.includes(fieldName)) {
				columnsToSelectInternal.push(child.fieldKey);
			}

			if (
				child.type === 'field' &&
				query.version &&
				collection.startsWith('shadow_') &&
				schema.collections[collection]?.fields['shadow_' + child.fieldKey]
			) {
				columnsToSelectInternal.push('shadow_' + child.fieldKey);
			}

			continue;
		}

		if (!child.relation) continue;

		if (child.type === 'm2o') {
			columnsToSelectInternal.push(child.relation.field);

			if (
				query.version &&
				collection.startsWith('shadow_') &&
				schema.collections[collection]?.fields['shadow_' + child.fieldKey]
			) {
				columnsToSelectInternal.push('shadow_' + child.relation.field);
			}
		}

		if (child.type === 'a2o') {
			columnsToSelectInternal.push(child.relation.field);
			columnsToSelectInternal.push(child.relation.meta!.one_collection_field!);
		}

		nestedCollectionNodes.push(child);
	}

	if (query.version && collection.startsWith('shadow_')) {
		Object.values(VERSION_SYSTEM_FIELDS).forEach((vf) => columnsToSelectInternal.push(vf.field));
	}

	const isAggregate = (query.group || (query.aggregate && Object.keys(query.aggregate).length > 0)) ?? false;

	/** Always fetch primary key in case there's a nested relation that needs it. Aggregate payloads
	 * can't have nested relational fields
	 */
	if (isAggregate === false && columnsToSelectInternal.includes(primaryKeyField) === false) {
		columnsToSelectInternal.push(primaryKeyField);
	}

	/** Make sure select list has unique values */
	const columnsToSelect = [...new Set(columnsToSelectInternal)];

	const fieldNodes = columnsToSelect.map(
		(column: string) =>
			children.find(
				(childNode) =>
					(childNode.type === 'field' || childNode.type === 'functionField') && childNode.fieldKey === column,
			) ?? {
				type: 'field',
				name: column,
				fieldKey: column,
			},
	) as FieldNode[];

	return { fieldNodes, nestedCollectionNodes, primaryKeyField };
}
