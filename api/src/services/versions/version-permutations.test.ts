/**
 * Tests every relation permutation from version_permutations.txt.
 *
 * Each case simulates the version sync logic that RelationsService.createOne performs:
 *   1. toVersionRelation on the FK relation (without reference)
 *   2. toVersionField + toVersionRelation with reference (when target is versioned)
 *   3. toVersionField with reference for alias fields (when one_collection is versioned)
 *
 * We verify the output fields/relations match the expected version table structure.
 */
import { SchemaBuilder } from '@directus/schema-builder';
import { getRelation } from '@directus/utils';
import { describe, expect, test } from 'vitest';
import { hasVersionTable } from './has-version-table.js';
import { toVersionField } from './to-version-field.js';
import { toVersionName } from './to-version-name.js';
import { toVersionRelation } from './to-version-relation.js';

const v = (name: string) => toVersionName(name);

// ════════════════════════════════════════════════════════════════════════════════
// Helpers — simulate what RelationsService.createOne does for version sync
// ════════════════════════════════════════════════════════════════════════════════

type VersionSyncResult = {
	relations: ReturnType<typeof toVersionRelation>[];
	refFields: { collection: string; field: string }[];
	aliasFields: { collection: string; field: string }[];
};

/**
 * Simulates the version sync portion of RelationsService.createOne.
 * Given a relation and the schema, produces the version relations/fields/aliases.
 */
function simulateVersionSync(
	relation: ReturnType<typeof getRelation>,
	schema: ReturnType<SchemaBuilder['build']>,
): VersionSyncResult {
	const result: VersionSyncResult = { relations: [], refFields: [], aliasFields: [] };

	if (!relation || !relation.collection) return result;
	if (!hasVersionTable(schema, relation.collection)) return result;

	const targetVersioned =
		!!relation.related_collection && !!schema.collections[relation.related_collection]?.versioning;

	// FK field on collection → create version relation (strip one_field for FK-only)
	if (schema.collections[relation.collection]?.fields[relation.field]) {
		const fkRelation = {
			...relation,
			meta: relation.meta ? { ...relation.meta, one_field: null } : null,
		};

		const versionedCollections = Object.entries(schema.collections)
			.filter(([, c]) => c.versioning)
			.map(([name]) => name);

		result.relations.push(toVersionRelation(fkRelation, { reference: false, versionedCollections }));

		if (targetVersioned) {
			result.refFields.push({
				collection: v(relation.collection),
				field: v(relation.field),
			});

			result.relations.push(toVersionRelation(fkRelation, { reference: true }));
		}
	}

	// Alias field on one_collection → create alias on V(one_collection)
	const oneCollection = relation.meta?.one_collection;
	const oneField = relation.meta?.one_field;

	if (oneField && oneCollection && schema.collections[oneCollection]?.versioning) {
		result.aliasFields.push({
			collection: v(oneCollection),
			field: v(oneField),
		});
	}

	return result;
}

// ════════════════════════════════════════════════════════════════════════════════
// M2O
// ════════════════════════════════════════════════════════════════════════════════

describe('M2O permutations', () => {
	describe('posts[v] authors[ ]', () => {
		const schema = new SchemaBuilder()
			.collection('posts', (c) => {
				c.field('id').id();
				c.field('author_id').m2o('authors');
			})
			.options({ versioning: true } as any)
			.collection('authors', (c) => c.field('id').id())
			.build();

		const relation = getRelation(schema.relations, 'posts', 'author_id')!;
		const sync = simulateVersionSync(relation, schema);

		test('creates one relation: dv_posts.author_id → authors', () => {
			expect(sync.relations).toHaveLength(1);

			const rel = sync.relations[0]!;
			expect(rel.collection).toBe(v('posts'));
			expect(rel.field).toBe('author_id');
			expect(rel.related_collection).toBe('authors');
		});

		test('no reference fields (target not versioned)', () => {
			expect(sync.refFields).toHaveLength(0);
		});

		test('no alias fields', () => {
			expect(sync.aliasFields).toHaveLength(0);
		});
	});

	describe('posts[v] authors[v]', () => {
		const schema = new SchemaBuilder()
			.collection('posts', (c) => {
				c.field('id').id();
				c.field('author_id').m2o('authors');
			})
			.options({ versioning: true } as any)
			.collection('authors', (c) => c.field('id').id())
			.options({ versioning: true } as any)
			.build();

		const relation = getRelation(schema.relations, 'posts', 'author_id')!;
		const sync = simulateVersionSync(relation, schema);

		test('creates two relations', () => {
			expect(sync.relations).toHaveLength(2);
		});

		test('first relation: dv_posts.author_id → authors', () => {
			const rel = sync.relations[0]!;
			expect(rel.collection).toBe(v('posts'));
			expect(rel.field).toBe('author_id');
			expect(rel.related_collection).toBe('authors');
		});

		test('second relation: dv_posts.dv_author_id → dv_authors', () => {
			const rel = sync.relations[1]!;
			expect(rel.collection).toBe(v('posts'));
			expect(rel.field).toBe(v('author_id'));
			expect(rel.related_collection).toBe(v('authors'));
		});

		test('creates reference field dv_posts.dv_author_id', () => {
			expect(sync.refFields).toHaveLength(1);

			expect(sync.refFields[0]).toEqual({
				collection: v('posts'),
				field: v('author_id'),
			});
		});

		test('no alias fields', () => {
			expect(sync.aliasFields).toHaveLength(0);
		});
	});

	describe('posts[ ] authors[*]', () => {
		const schema = new SchemaBuilder()
			.collection('posts', (c) => {
				c.field('id').id();
				c.field('author_id').m2o('authors');
			})
			.collection('authors', (c) => c.field('id').id())
			.options({ versioning: true } as any)
			.build();

		const relation = getRelation(schema.relations, 'posts', 'author_id')!;
		const sync = simulateVersionSync(relation, schema);

		test('nothing — posts has no version table', () => {
			expect(sync.relations).toHaveLength(0);
			expect(sync.refFields).toHaveLength(0);
			expect(sync.aliasFields).toHaveLength(0);
		});
	});
});

// ════════════════════════════════════════════════════════════════════════════════
// O2M
// ════════════════════════════════════════════════════════════════════════════════

describe('O2M permutations', () => {
	describe('posts[v] comments[v]', () => {
		const schema = new SchemaBuilder()
			.collection('posts', (c) => {
				c.field('id').id();
				c.field('comments').o2m('comments', 'post_id');
			})
			.options({ versioning: true } as any)
			.collection('comments', (c) => c.field('id').id())
			.options({ versioning: true } as any)
			.build();

		// O2M produces an M2O relation on the FK side: comments.post_id → posts
		const fkRelation = getRelation(schema.relations, 'comments', 'post_id')!;
		const fkSync = simulateVersionSync(fkRelation, schema);

		// And the alias side: posts.comments (one_field)
		// The alias sync is handled within the FK relation's sync via one_field/one_collection

		test('FK side: creates two relations', () => {
			expect(fkSync.relations).toHaveLength(2);
		});

		test('FK side: first relation dv_comments.post_id → posts', () => {
			const rel = fkSync.relations[0]!;
			expect(rel.collection).toBe(v('comments'));
			expect(rel.field).toBe('post_id');
			expect(rel.related_collection).toBe('posts');
		});

		test('FK side: second relation dv_comments.dv_post_id → dv_posts', () => {
			const rel = fkSync.relations[1]!;
			expect(rel.collection).toBe(v('comments'));
			expect(rel.field).toBe(v('post_id'));
			expect(rel.related_collection).toBe(v('posts'));
		});

		test('FK side: creates reference field dv_comments.dv_post_id', () => {
			expect(fkSync.refFields).toHaveLength(1);

			expect(fkSync.refFields[0]).toEqual({
				collection: v('comments'),
				field: v('post_id'),
			});
		});

		test('alias side: creates alias dv_posts.dv_comments', () => {
			expect(fkSync.aliasFields).toHaveLength(1);

			expect(fkSync.aliasFields[0]).toEqual({
				collection: v('posts'),
				field: v('comments'),
			});
		});
	});

	describe('posts[v] comments[ ]', () => {
		const schema = new SchemaBuilder()
			.collection('posts', (c) => {
				c.field('id').id();
				c.field('comments').o2m('comments', 'post_id');
			})
			.options({ versioning: true } as any)
			.collection('comments', (c) => c.field('id').id())
			.build();

		const fkRelation = getRelation(schema.relations, 'comments', 'post_id')!;
		const fkSync = simulateVersionSync(fkRelation, schema);

		test('FK side: nothing (comments not versioned)', () => {
			expect(fkSync.relations).toHaveLength(0);
			expect(fkSync.refFields).toHaveLength(0);
		});

		test('alias side: nothing (comments not versioned, alias would have no target)', () => {
			expect(fkSync.aliasFields).toHaveLength(0);
		});
	});

	describe('posts[ ] comments[v]', () => {
		const schema = new SchemaBuilder()
			.collection('posts', (c) => {
				c.field('id').id();
				c.field('comments').o2m('comments', 'post_id');
			})
			.collection('comments', (c) => c.field('id').id())
			.options({ versioning: true } as any)
			.build();

		const fkRelation = getRelation(schema.relations, 'comments', 'post_id')!;
		const fkSync = simulateVersionSync(fkRelation, schema);

		test('FK side: creates one relation dv_comments.post_id → posts', () => {
			expect(fkSync.relations).toHaveLength(1);

			const rel = fkSync.relations[0]!;
			expect(rel.collection).toBe(v('comments'));
			expect(rel.field).toBe('post_id');
			expect(rel.related_collection).toBe('posts');
		});

		test('FK side: no reference fields (posts not versioned)', () => {
			expect(fkSync.refFields).toHaveLength(0);
		});

		test('alias side: nothing (posts not versioned)', () => {
			expect(fkSync.aliasFields).toHaveLength(0);
		});
	});

	describe('posts[ ] comments[ ]', () => {
		const schema = new SchemaBuilder()
			.collection('posts', (c) => {
				c.field('id').id();
				c.field('comments').o2m('comments', 'post_id');
			})
			.collection('comments', (c) => c.field('id').id())
			.build();

		const fkRelation = getRelation(schema.relations, 'comments', 'post_id')!;
		const fkSync = simulateVersionSync(fkRelation, schema);

		test('nothing — no version tables exist', () => {
			expect(fkSync.relations).toHaveLength(0);
			expect(fkSync.refFields).toHaveLength(0);
			expect(fkSync.aliasFields).toHaveLength(0);
		});
	});
});

// ════════════════════════════════════════════════════════════════════════════════
// M2M
// ════════════════════════════════════════════════════════════════════════════════

describe('M2M permutations', () => {
	describe('posts[v] tags[ ]', () => {
		// Build schema with versioned posts but add junction manually
		const schema = new SchemaBuilder()
			.collection('posts', (c) => {
				c.field('id').id();
				c.field('tags').m2m('tags');
			})
			.options({ versioning: true } as any)
			.collection('tags', (c) => c.field('id').id())
			// Junction table gets a version counterpart when parent is versioned
			.collection(v('posts_tags_junction'), (c) => c.field('id').id())
			.build();

		// M2M left: junction.posts_id → posts (O2M from posts side)
		const leftRelation = getRelation(schema.relations, 'posts', 'tags')!;
		const leftSync = simulateVersionSync(leftRelation, schema);

		// M2M right: junction.tags_id → tags (M2O)
		const rightRelation = getRelation(schema.relations, 'posts_tags_junction', 'tags_id')!;
		const rightSync = simulateVersionSync(rightRelation, schema);

		test('alias: creates dv_posts.dv_tags', () => {
			// The alias comes from the left/O2M relation sync
			expect(leftSync.aliasFields).toHaveLength(1);

			expect(leftSync.aliasFields[0]).toEqual({
				collection: v('posts'),
				field: v('tags'),
			});
		});

		test('posts_id FK (target posts[v]): creates relation + ref field + ref relation', () => {
			// Left relation is O2M: posts.tags → junction.posts_id
			// The FK side is junction.posts_id, which is the leftRelation itself
			// But the actual FK relation is the M2O on the junction
			const junctionLeftRelation = getRelation(schema.relations, 'posts_tags_junction', 'posts_id')!;
			const junctionLeftSync = simulateVersionSync(junctionLeftRelation, schema);

			// Should produce: relation + ref field + ref relation = 2 relations + 1 ref field
			expect(junctionLeftSync.relations).toHaveLength(2);
			expect(junctionLeftSync.refFields).toHaveLength(1);

			// First: dv_posts_tags_junction.posts_id → posts
			expect(junctionLeftSync.relations[0]!.collection).toBe(v('posts_tags_junction'));
			expect(junctionLeftSync.relations[0]!.field).toBe('posts_id');
			expect(junctionLeftSync.relations[0]!.related_collection).toBe('posts');

			// Second: dv_posts_tags_junction.dv_posts_id → dv_posts
			expect(junctionLeftSync.relations[1]!.collection).toBe(v('posts_tags_junction'));
			expect(junctionLeftSync.relations[1]!.field).toBe(v('posts_id'));
			expect(junctionLeftSync.relations[1]!.related_collection).toBe(v('posts'));

			// Ref field
			expect(junctionLeftSync.refFields[0]).toEqual({
				collection: v('posts_tags_junction'),
				field: v('posts_id'),
			});
		});

		test('tags_id FK (target tags[ ]): creates relation only (no ref)', () => {
			expect(rightSync.relations).toHaveLength(1);
			expect(rightSync.refFields).toHaveLength(0);

			expect(rightSync.relations[0]!.collection).toBe(v('posts_tags_junction'));
			expect(rightSync.relations[0]!.field).toBe('tags_id');
			expect(rightSync.relations[0]!.related_collection).toBe('tags');
		});
	});

	describe('posts[v] tags[v]', () => {
		const schema = new SchemaBuilder()
			.collection('posts', (c) => {
				c.field('id').id();
				c.field('tags').m2m('tags');
			})
			.options({ versioning: true } as any)
			.collection('tags', (c) => c.field('id').id())
			.options({ versioning: true } as any)
			.collection(v('posts_tags_junction'), (c) => c.field('id').id())
			.build();

		test('alias: creates dv_posts.dv_tags', () => {
			const leftRelation = getRelation(schema.relations, 'posts', 'tags')!;
			const leftSync = simulateVersionSync(leftRelation, schema);

			expect(leftSync.aliasFields).toHaveLength(1);

			expect(leftSync.aliasFields[0]).toEqual({
				collection: v('posts'),
				field: v('tags'),
			});
		});

		test('posts_id FK (target posts[v]): relation + ref field + ref relation', () => {
			const junctionLeftRelation = getRelation(schema.relations, 'posts_tags_junction', 'posts_id')!;
			const sync = simulateVersionSync(junctionLeftRelation, schema);

			expect(sync.relations).toHaveLength(2);
			expect(sync.refFields).toHaveLength(1);

			expect(sync.relations[0]!.collection).toBe(v('posts_tags_junction'));
			expect(sync.relations[0]!.field).toBe('posts_id');
			expect(sync.relations[0]!.related_collection).toBe('posts');

			expect(sync.relations[1]!.collection).toBe(v('posts_tags_junction'));
			expect(sync.relations[1]!.field).toBe(v('posts_id'));
			expect(sync.relations[1]!.related_collection).toBe(v('posts'));
		});

		test('tags_id FK (target tags[v]): relation + ref field + ref relation', () => {
			const rightRelation = getRelation(schema.relations, 'posts_tags_junction', 'tags_id')!;
			const sync = simulateVersionSync(rightRelation, schema);

			expect(sync.relations).toHaveLength(2);
			expect(sync.refFields).toHaveLength(1);

			expect(sync.relations[0]!.collection).toBe(v('posts_tags_junction'));
			expect(sync.relations[0]!.field).toBe('tags_id');
			expect(sync.relations[0]!.related_collection).toBe('tags');

			expect(sync.relations[1]!.collection).toBe(v('posts_tags_junction'));
			expect(sync.relations[1]!.field).toBe(v('tags_id'));
			expect(sync.relations[1]!.related_collection).toBe(v('tags'));
		});
	});

	describe('posts[ ] tags[ ]', () => {
		const schema = new SchemaBuilder()
			.collection('posts', (c) => {
				c.field('id').id();
				c.field('tags').m2m('tags');
			})
			.collection('tags', (c) => c.field('id').id())
			.build();

		test('nothing — no version tables exist', () => {
			const leftRelation = getRelation(schema.relations, 'posts', 'tags')!;
			const leftSync = simulateVersionSync(leftRelation, schema);

			const rightRelation = getRelation(schema.relations, 'posts_tags_junction', 'tags_id')!;
			const rightSync = simulateVersionSync(rightRelation, schema);

			expect(leftSync.relations).toHaveLength(0);
			expect(leftSync.aliasFields).toHaveLength(0);
			expect(rightSync.relations).toHaveLength(0);
		});
	});
});

// ════════════════════════════════════════════════════════════════════════════════
// M2A
// ════════════════════════════════════════════════════════════════════════════════

describe('M2A permutations', () => {
	describe('posts[v] blocks[ ]', () => {
		const schema = new SchemaBuilder()
			.collection('posts', (c) => {
				c.field('id').id();
				c.field('blocks').m2a(['blocks']);
			})
			.options({ versioning: true } as any)
			.collection('blocks', (c) => c.field('id').id())
			// Junction version counterpart exists
			.collection(v('posts_builder'), (c) => c.field('id').id())
			.build();

		test('alias: creates dv_posts.dv_blocks', () => {
			const fkRelation = getRelation(schema.relations, 'posts', 'blocks')!;
			const sync = simulateVersionSync(fkRelation, schema);

			expect(sync.aliasFields).toHaveLength(1);

			expect(sync.aliasFields[0]).toEqual({
				collection: v('posts'),
				field: v('blocks'),
			});
		});

		test('posts_id FK (target posts[v]): relation + ref field + ref relation', () => {
			const junctionFkRelation = getRelation(schema.relations, 'posts_builder', 'posts_id')!;
			const sync = simulateVersionSync(junctionFkRelation, schema);

			expect(sync.relations).toHaveLength(2);
			expect(sync.refFields).toHaveLength(1);

			expect(sync.relations[0]!.collection).toBe(v('posts_builder'));
			expect(sync.relations[0]!.field).toBe('posts_id');
			expect(sync.relations[0]!.related_collection).toBe('posts');

			expect(sync.relations[1]!.collection).toBe(v('posts_builder'));
			expect(sync.relations[1]!.field).toBe(v('posts_id'));
			expect(sync.relations[1]!.related_collection).toBe(v('posts'));
		});

		test('item poly (target blocks[ ]): relation with empty allowed_collections', () => {
			const itemRelation = getRelation(schema.relations, 'posts_builder', 'item')!;
			const sync = simulateVersionSync(itemRelation, schema);

			expect(sync.relations).toHaveLength(1);
			expect(sync.relations[0]!.collection).toBe(v('posts_builder'));
			expect(sync.relations[0]!.field).toBe('item');
			// blocks is not versioned — excluded from version allowed_collections
			expect(sync.relations[0]!.meta!.one_allowed_collections).toEqual([]);
		});
	});

	describe('posts[v] blocks[v]', () => {
		const schema = new SchemaBuilder()
			.collection('posts', (c) => {
				c.field('id').id();
				c.field('blocks').m2a(['blocks']);
			})
			.options({ versioning: true } as any)
			.collection('blocks', (c) => c.field('id').id())
			.options({ versioning: true } as any)
			.collection(v('posts_builder'), (c) => c.field('id').id())
			.build();

		test('alias: creates dv_posts.dv_blocks', () => {
			const fkRelation = getRelation(schema.relations, 'posts', 'blocks')!;
			const sync = simulateVersionSync(fkRelation, schema);

			expect(sync.aliasFields).toHaveLength(1);

			expect(sync.aliasFields[0]).toEqual({
				collection: v('posts'),
				field: v('blocks'),
			});
		});

		test('posts_id FK (target posts[v]): relation + ref field + ref relation', () => {
			const junctionFkRelation = getRelation(schema.relations, 'posts_builder', 'posts_id')!;
			const sync = simulateVersionSync(junctionFkRelation, schema);

			expect(sync.relations).toHaveLength(2);
			expect(sync.refFields).toHaveLength(1);
		});

		test('item poly (target blocks[v]): relation with versioned targets in allowed_collections', () => {
			const itemRelation = getRelation(schema.relations, 'posts_builder', 'item')!;
			const sync = simulateVersionSync(itemRelation, schema);

			expect(sync.relations).toHaveLength(1);
			expect(sync.relations[0]!.collection).toBe(v('posts_builder'));
			expect(sync.relations[0]!.field).toBe('item');
			// blocks is versioned so allowed_collections becomes [blocks, dv_blocks]
			expect(sync.relations[0]!.meta!.one_allowed_collections).toEqual(['blocks', v('blocks')]);
		});
	});

	describe('posts[ ] blocks[ ]', () => {
		const schema = new SchemaBuilder()
			.collection('posts', (c) => {
				c.field('id').id();
				c.field('blocks').m2a(['blocks']);
			})
			.collection('blocks', (c) => c.field('id').id())
			.build();

		test('nothing — no version tables exist', () => {
			const fkRelation = getRelation(schema.relations, 'posts', 'blocks')!;
			const fkSync = simulateVersionSync(fkRelation, schema);

			const itemRelation = getRelation(schema.relations, 'posts_builder', 'item')!;
			const itemSync = simulateVersionSync(itemRelation, schema);

			expect(fkSync.relations).toHaveLength(0);
			expect(fkSync.aliasFields).toHaveLength(0);
			expect(itemSync.relations).toHaveLength(0);
		});
	});
});

// ════════════════════════════════════════════════════════════════════════════════
// Relation detail verification — check schema-level fields on versioned relations
// ════════════════════════════════════════════════════════════════════════════════

describe('relation detail verification', () => {
	test('M2O ref relation points FK column to version PK (directus_version_id)', () => {
		const schema = new SchemaBuilder()
			.collection('posts', (c) => {
				c.field('id').id();
				c.field('author_id').m2o('authors');
			})
			.options({ versioning: true } as any)
			.collection('authors', (c) => c.field('id').id())
			.options({ versioning: true } as any)
			.build();

		const relation = getRelation(schema.relations, 'posts', 'author_id')!;
		const fkRelation = { ...relation, meta: relation.meta ? { ...relation.meta, one_field: null } : null };
		const refRel = toVersionRelation(fkRelation, { reference: true });

		expect(refRel.schema!.foreign_key_column).toBe('directus_version_id');
		expect(refRel.schema!.foreign_key_table).toBe(v('authors'));
	});

	test('O2M ref relation versions one_field alias name', () => {
		const schema = new SchemaBuilder()
			.collection('posts', (c) => {
				c.field('id').id();
				c.field('comments').o2m('comments', 'post_id');
			})
			.options({ versioning: true } as any)
			.collection('comments', (c) => c.field('id').id())
			.options({ versioning: true } as any)
			.build();

		const fkRelation = getRelation(schema.relations, 'comments', 'post_id')!;
		const fkOnly = { ...fkRelation, meta: fkRelation.meta ? { ...fkRelation.meta, one_field: null } : null };
		const refRel = toVersionRelation(fkOnly, { reference: true });

		// O2M detection relies on one_field + no junction_field
		// Since we nulled one_field, this is treated as M2O → field gets versioned
		expect(refRel.collection).toBe(v('comments'));
		expect(refRel.field).toBe(v('post_id'));
		expect(refRel.related_collection).toBe(v('posts'));
	});

	test('M2A one_allowed_collections only includes versioned targets (both original + version)', () => {
		const schema = new SchemaBuilder()
			.collection('posts', (c) => {
				c.field('id').id();
				c.field('blocks').m2a(['blocks', 'widgets']);
			})
			.options({ versioning: true } as any)
			.collection('blocks', (c) => c.field('id').id())
			.options({ versioning: true } as any)
			.collection('widgets', (c) => c.field('id').id())
			.build();

		const itemRelation = getRelation(schema.relations, 'posts_builder', 'item')!;

		// Simulate allowed_collections computation — non-versioned targets excluded
		const oneAllowedCollections = itemRelation.meta?.one_allowed_collections?.flatMap((collection) =>
			schema.collections[collection]?.versioning ? [collection, v(collection)] : [],
		);

		expect(oneAllowedCollections).toEqual(['blocks', v('blocks')]);
	});

	test('toVersionField reference mode versions field name and schema.name', () => {
		const field = {
			collection: 'posts',
			field: 'author_id',
			type: 'integer' as const,
			schema: {
				table: 'posts',
				name: 'author_id',
				data_type: 'integer',
				default_value: null,
				max_length: null,
				numeric_precision: null,
				numeric_scale: null,
				is_generated: false,
				generation_expression: null,
				is_nullable: true,
				is_unique: false,
				is_indexed: false,
				is_primary_key: false,
				has_auto_increment: false,
				foreign_key_schema: null,
				foreign_key_table: null,
				foreign_key_column: null,
				comment: null,
			},
			meta: {
				id: 1,
				collection: 'posts',
				field: 'author_id',
				special: ['m2o'],
				interface: 'select-dropdown-m2o',
				options: null,
				display: null,
				display_options: null,
				readonly: false,
				hidden: false,
				sort: 2,
				width: 'full',
				translations: null,
				note: null,
				conditions: null,
				required: false,
				group: null,
				validation: null,
				validation_message: null,
			},
		} as any;

		const result = toVersionField(field, { reference: true });

		expect(result.field).toBe(v('author_id'));
		expect(result.collection).toBe(v('posts'));
		expect(result.schema!.name).toBe(v('author_id'));
		expect(result.schema!.table).toBe(v('posts'));
		expect(result.meta!.field).toBe(v('author_id'));
		expect(result.meta!.collection).toBe(v('posts'));
	});
});
