import type { Query, SchemaOverview } from '@directus/types';
import { VERSION_SYSTEM_FIELDS } from '../../../services/versions/constants.js';
import { toVersionNode } from '../../../services/versions/to-version-node.js';
import type { FieldNode, FunctionFieldNode, NestedCollectionNode } from '../../../types/ast.js';
import { parseFilterKey } from '../../../utils/parse-filter-key.js';

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
			const { fieldName } = parseFilterKey(child.name);

			if (columnsInCollection.includes(fieldName)) {
				columnsToSelectInternal.push(child.fieldKey);
			}

			// TODO: skip if raw (/versions)
			const isVersionedCollection = schema.collections[collection]?.versionOf;

			const versionField = schema.collections[collection]?.fields[child.fieldKey]?.versionedBy;

			if (isVersionedCollection && versionField) {
				columnsToSelectInternal.push(versionField);
			}

			continue;
		}

		if (!child.relation) continue;

		if (child.type === 'm2o') {
			columnsToSelectInternal.push(child.relation.field);

			// TODO: skip if raw (/versions)
			const isVersionedCollection = schema.collections[child.relation.collection]?.versionOf;

			const versionField = schema.collections[child.relation.collection]?.fields[child.relation.field]?.versionedBy;

			if (isVersionedCollection && versionField) {
				columnsToSelectInternal.push(versionField);
				nestedCollectionNodes.push(toVersionNode(child));
			}
		}

		if (child.type === 'a2o') {
			columnsToSelectInternal.push(child.relation.field);
			columnsToSelectInternal.push(child.relation.meta!.one_collection_field!);
		}

		nestedCollectionNodes.push(child);
	}

	// TODO: skip if raw (/versions)
	if (schema.collections[collection]?.versionOf) {
		// inject version fields for "meta"
		Object.values(VERSION_SYSTEM_FIELDS).forEach((f) => {
			columnsToSelectInternal.push(f.field);
		});
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
