import type { Accountability, PermissionsAction } from '@directus/types';
import type { AST } from '../../../types/ast.js';
import { fetchPermissions } from '../../lib/fetch-permissions.js';
import { fetchPolicies } from '../../lib/fetch-policies.js';
import type { Context } from '../../types.js';
import { fieldMapFromAst } from './lib/field-map-from-ast.js';
import { injectCases } from './lib/inject-cases.js';
import type { FieldMap } from './types.js';
import { collectionsInFieldMap } from './utils/collections-in-field-map.js';
import { validatePathExistence } from './utils/validate-path/validate-path-existence.js';
import { validatePathPermissions } from './utils/validate-path/validate-path-permissions.js';

export interface ProcessAstOptions {
	ast: AST;
	action: PermissionsAction;
	accountability: Accountability | null;
}

export async function processAst(options: ProcessAstOptions, context: Context) {
	// FieldMap is a Map of paths in the AST, with each path containing the collection and fields in
	// that collection that the AST path tries to access
	const fieldMap: FieldMap = fieldMapFromAst(options.ast, context.schema);
	const collections = collectionsInFieldMap(fieldMap);

	if (options.ast.query.version) {
		for (const collection of collections) {
			if (collection.startsWith('shadow_')) {
				collections.push(collection.replace('shadow_', ''));
			}
		}
	}

	if (!options.accountability || options.accountability.admin) {
		// Validate the field existence, even if no permissions apply to the current accountability
		for (const [path, { collection, fields }] of [...fieldMap.read.entries(), ...fieldMap.other.entries()]) {
			validatePathExistence(path, collection, fields, context.schema);
		}

		return options.ast;
	}

	const policies = await fetchPolicies(options.accountability, context);

	const permissions = await fetchPermissions(
		{ action: options.action, policies, collections, accountability: options.accountability },
		context,
	);

	const readPermissions =
		options.action === 'read'
			? permissions
			: await fetchPermissions(
					{ action: 'read', policies, collections, accountability: options.accountability },
					context,
				);

	// Validate field existence first
	for (const [path, { collection, fields }] of [...fieldMap.read.entries(), ...fieldMap.other.entries()]) {
		validatePathExistence(path, collection, fields, context.schema);
	}

	// Validate permissions for the fields
	for (const [path, { collection, fields }] of fieldMap.other.entries()) {
		if (options.action === 'read' && options.ast.query.version && collection.startsWith('shadow_')) {
			// check read access to main + fields
			validatePathPermissions(path, permissions, collection.replace('shadow_', ''), fields);

			// check read access to shadow collection
			validatePathPermissions(path, readPermissions, collection, new Set());
		} else {
			validatePathPermissions(path, permissions, collection, fields);
		}
	}

	// Validate permission for read only fields
	for (const [path, { collection, fields }] of fieldMap.read.entries()) {
		if (options.action === 'read' && options.ast.query.version && collection.startsWith('shadow_')) {
			// check read access to main + fields
			validatePathPermissions(path, readPermissions, collection.replace('shadow_', ''), fields);

			// check read access to shadow collection
			validatePathPermissions(path, readPermissions, collection, new Set());
		} else {
			validatePathPermissions(path, readPermissions, collection, fields);
		}
	}

	injectCases(options.ast, permissions);

	return options.ast;
}
