import type { Item, SchemaOverview } from '@directus/types';
import { toArray } from '@directus/utils';
import { isNil, merge, uniq, unset } from 'lodash-es';
import { toVersionNode } from '../../../services/versions/to-version-node.js';
import type { NestedCollectionNode } from '../../../types/ast.js';

export function applyParentFilters(
	schema: SchemaOverview,
	nestedCollectionNodes: NestedCollectionNode[],
	parentItem: Item | Item[],
	version: boolean,
) {
	const parentItems = toArray(parentItem);

	const versionNestedCollectionNodes = [];

	for (const nestedNode of nestedCollectionNodes) {
		if (!nestedNode.relation) continue;

		if (nestedNode.type === 'm2o') {
			const foreignField = schema.collections[nestedNode.relation.related_collection!]!.primary;
			const foreignIds = uniq(parentItems.map((res) => res[nestedNode.relation.field])).filter((id) => !isNil(id));

			merge(nestedNode, { query: { filter: { [foreignField]: { _in: foreignIds } } } });

			if (
				version &&
				nestedNode.relation.collection.startsWith('shadow_') &&
				schema.collections[nestedNode.relation.collection]?.fields['shadow_' + nestedNode.relation.field]
			) {
				const versionForeignField = schema.collections['shadow_' + nestedNode.relation.related_collection!]!.primary;

				const versionForeignIds = uniq(parentItems.map((res) => res['shadow_' + nestedNode.relation.field])).filter(
					(id) => !isNil(id),
				);

				const versionNode = toVersionNode(nestedNode);

				// reset filter
				unset(versionNode, `query.filter.${foreignField}`);

				versionNestedCollectionNodes.push(
					merge(versionNode, {
						query: { filter: { [versionForeignField]: { _in: versionForeignIds } } },
						version: undefined,
					}),
				);
			}
		} else if (nestedNode.type === 'o2m') {
			const relatedM2OisFetched = !!nestedNode.children.find((child) => {
				return child.type === 'field' && child.name === nestedNode.relation.field;
			});

			if (relatedM2OisFetched === false) {
				nestedNode.children.push({
					type: 'field',
					name: nestedNode.relation.field,
					fieldKey: nestedNode.relation.field,
					whenCase: [],
					alias: false,
				});
			}

			if (nestedNode.relation.meta?.sort_field) {
				nestedNode.children.push({
					type: 'field',
					name: nestedNode.relation.meta.sort_field,
					fieldKey: nestedNode.relation.meta.sort_field,
					whenCase: [],
					alias: false,
				});
			}

			const foreignField = nestedNode.relation.field;
			const foreignIds = uniq(parentItems.map((res) => res[nestedNode.parentKey])).filter((id) => !isNil(id));

			merge(nestedNode, { query: { filter: { [foreignField]: { _in: foreignIds } } } });
		} else if (nestedNode.type === 'a2o') {
			const keysPerCollection: { [collection: string]: (string | number)[] } = {};

			for (const parentItem of parentItems) {
				const collection = parentItem[nestedNode.relation.meta!.one_collection_field!];
				if (!keysPerCollection[collection]) keysPerCollection[collection] = [];
				keysPerCollection[collection]!.push(parentItem[nestedNode.relation.field]);
			}

			for (const relatedCollection of nestedNode.names) {
				const foreignField = nestedNode.relatedKey[relatedCollection]!;
				const foreignIds = uniq(keysPerCollection[relatedCollection]);

				merge(nestedNode, {
					query: { [relatedCollection]: { filter: { [foreignField]: { _in: foreignIds } }, limit: foreignIds.length } },
				});
			}
		}
	}

	return [...nestedCollectionNodes, ...versionNestedCollectionNodes];
}
