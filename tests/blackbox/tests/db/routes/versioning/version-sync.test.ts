import { getUrl } from '@common/config';
import { DisableTestCachingSetup } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

const DV = 'directus_versions_';

const ALL_COLLECTIONS = [
	`${DV}posts_tags`,
	`${DV}posts_blocks`,
	`${DV}posts`,
	`${DV}authors`,
	`${DV}comments`,
	`${DV}tags`,
	`${DV}blocks`,
	'posts_tags',
	'posts_blocks',
	'posts',
	'authors',
	'comments',
	'tags',
	'blocks',
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function api(vendor: string) {
	return request(getUrl(vendor)).set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);
}

async function cleanup(vendor: string) {
	for (const name of ALL_COLLECTIONS) {
		try {
			await api(vendor).delete(`/collections/${name}`);
		} catch {
			/* ignore */
		}
	}
}

async function createCollection(vendor: string, collection: string, meta: Record<string, any> = {}) {
	const existing = await api(vendor).get(`/collections/${collection}`);
	if (existing.body.data) return existing.body.data;

	const fields = [
		{
			field: 'id',
			type: 'integer',
			schema: { is_primary_key: true, has_auto_increment: true },
			meta: { hidden: true, readonly: true, interface: 'input' },
		},
	];

	const response = await api(vendor).post('/collections').send({ collection, schema: {}, meta, fields });
	expect(response.statusCode).toBe(200);
	return response.body.data;
}

async function updateCollection(vendor: string, collection: string, meta: Record<string, any>) {
	const response = await api(vendor).patch(`/collections/${collection}`).send({ meta });
	expect(response.statusCode).toBe(200);
	return response.body.data;
}

async function createField(
	vendor: string,
	collection: string,
	field: string,
	type: string,
	meta: Record<string, any> = {},
	schema: Record<string, any> | null = {},
) {
	const response = await api(vendor).post(`/fields/${collection}`).send({ field, type, meta, schema });
	expect(response.statusCode).toBe(200);
	return response.body.data;
}

async function updateField(vendor: string, collection: string, field: string, updates: Record<string, any>) {
	const response = await api(vendor).patch(`/fields/${collection}/${field}`).send(updates);
	expect(response.statusCode).toBe(200);
	return response.body.data;
}

async function deleteField(vendor: string, collection: string, field: string) {
	const response = await api(vendor).delete(`/fields/${collection}/${field}`);
	expect(response.statusCode).toBe(204);
}

async function createRelation(
	vendor: string,
	collection: string,
	field: string,
	related_collection: string | null,
	meta: Record<string, any> = {},
	schema: Record<string, any> | null = {},
) {
	const existing = await api(vendor).get(`/relations/${collection}/${field}`);
	if (existing.statusCode === 200) return existing.body.data;

	const response = await api(vendor).post('/relations').send({ collection, field, related_collection, meta, schema });
	expect(response.statusCode).toBe(200);
	return response.body.data;
}

async function deleteRelation(vendor: string, collection: string, field: string) {
	const response = await api(vendor).delete(`/relations/${collection}/${field}`);
	expect(response.statusCode).toBe(204);
}

async function createM2O(vendor: string, collection: string, field: string, otherCollection: string) {
	await createField(vendor, collection, field, 'integer', { special: ['m2o'], interface: 'select-dropdown-m2o' });
	return createRelation(vendor, collection, field, otherCollection, {}, { on_delete: 'SET NULL' });
}

async function createO2M(
	vendor: string,
	collection: string,
	field: string,
	otherCollection: string,
	otherField: string,
) {
	await createField(vendor, collection, field, 'alias', { special: ['o2m'], interface: 'list-o2m' }, null);

	await createField(vendor, otherCollection, otherField, 'integer', {
		interface: 'select-dropdown-m2o',
		hidden: true,
	});

	return createRelation(
		vendor,
		otherCollection,
		otherField,
		collection,
		{ one_field: field },
		{ on_delete: 'SET NULL' },
	);
}

async function createM2M(
	vendor: string,
	collection: string,
	field: string,
	otherCollection: string,
	junctionCollection: string,
	opts: { junctionMeta?: Record<string, any>; otherField?: string } = {},
) {
	await createField(vendor, collection, field, 'alias', { special: ['m2m'], interface: 'list-m2m' }, null);
	await createCollection(vendor, junctionCollection, { hidden: true, icon: 'import_export', ...opts.junctionMeta });
	const leftFK = `${collection}_id`;
	const rightFK = `${otherCollection}_id`;
	await createField(vendor, junctionCollection, leftFK, 'integer', { hidden: true });
	await createField(vendor, junctionCollection, rightFK, 'integer', { hidden: true });

	await createRelation(
		vendor,
		junctionCollection,
		leftFK,
		collection,
		{ one_field: field, junction_field: rightFK },
		{ on_delete: 'SET NULL' },
	);

	await createRelation(
		vendor,
		junctionCollection,
		rightFK,
		otherCollection,
		{ one_field: opts.otherField ?? null, junction_field: leftFK },
		{ on_delete: 'SET NULL' },
	);
}

async function createM2A(
	vendor: string,
	collection: string,
	field: string,
	relatedCollections: string[],
	junctionCollection: string,
	opts: { junctionMeta?: Record<string, any> } = {},
) {
	await createField(vendor, collection, field, 'alias', { special: ['m2a'], interface: 'list-m2a' }, null);
	await createCollection(vendor, junctionCollection, { hidden: true, icon: 'import_export', ...opts.junctionMeta });
	const fkField = `${collection}_id`;
	await createField(vendor, junctionCollection, fkField, 'integer', { hidden: true });
	await createField(vendor, junctionCollection, 'item', 'string', { hidden: true });
	await createField(vendor, junctionCollection, 'collection', 'string', { hidden: true });

	await createRelation(
		vendor,
		junctionCollection,
		'item',
		null,
		{
			one_allowed_collections: relatedCollections,
			one_collection_field: 'collection',
			junction_field: fkField,
		},
		null,
	);

	await createRelation(
		vendor,
		junctionCollection,
		fkField,
		collection,
		{ one_field: field, junction_field: 'item' },
		{ on_delete: 'SET NULL' },
	);
}

async function createItem(vendor: string, collection: string, item: Record<string, any>) {
	const response = await api(vendor).post(`/items/${collection}`).send(item);
	expect(response.statusCode).toBe(200);
	return response.body.data;
}

// ── Query helpers ────────────────────────────────────────────────────────────

async function getFields(vendor: string, collection: string) {
	return (await api(vendor).get(`/fields/${collection}`)).body.data ?? [];
}

async function fieldNames(vendor: string, collection: string): Promise<string[]> {
	return (await getFields(vendor, collection)).map((f: any) => f.field);
}

async function collectionExists(vendor: string, name: string) {
	const { statusCode } = await api(vendor).get(`/collections/${name}`);
	if (statusCode === 200) return true;
	const { body } = await api(vendor).get(`/fields/${name}`);
	return body.data !== undefined && body.data !== null && body.data.length > 0;
}

async function fieldExists(vendor: string, collection: string, field: string) {
	return (await getFields(vendor, collection)).some((f: any) => f.field === field);
}

async function relationExists(vendor: string, collection: string, field: string) {
	const rels = (await api(vendor).get('/relations')).body.data ?? [];
	// Check for meta presence — FK-only ghosts (SQLite can't drop FK constraints) are ignored
	return rels.some((r: any) => r.collection === collection && r.field === field && r.meta);
}

async function findRelation(vendor: string, collection: string, field: string) {
	const rels = (await api(vendor).get('/relations')).body.data ?? [];
	return rels.find((r: any) => r.collection === collection && r.field === field);
}

// ═════════════════════════════════════════════════════════════════════════════
// Tests
// ═════════════════════════════════════════════════════════════════════════════

describe('/versioning', () => {
	DisableTestCachingSetup();

	afterEach(async () => {
		for (const vendor of vendors) {
			await cleanup(vendor);
		}
	});

	// ── 1. Collection creation with versioning ─────────────────────────────

	describe('Collection versioning', () => {
		it.each(vendors)('%s creates version table when collection created with versioning:true', async (vendor) => {
			await createCollection(vendor, 'posts', { versioning: true });

			expect(await collectionExists(vendor, `${DV}posts`)).toBe(true);
			const fields = await fieldNames(vendor, `${DV}posts`);
			expect(fields).toContain('directus_version_id');
			expect(fields).toContain('id');
		});

		it.each(vendors)('%s version table has versioning:false (no recursion)', async (vendor) => {
			await createCollection(vendor, 'posts', { versioning: true });
			expect(await collectionExists(vendor, `${DV}${DV}posts`)).toBe(false);
		});

		it.each(vendors)('%s no version table for non-versioned collection', async (vendor) => {
			await createCollection(vendor, 'posts');
			expect(await collectionExists(vendor, `${DV}posts`)).toBe(false);
		});
	});

	// ── 2. Enable/disable versioning ───────────────────────────────────────

	describe('Enable/disable versioning', () => {
		it.each(vendors)('%s enabling versioning creates version table with existing real fields', async (vendor) => {
			await createCollection(vendor, 'posts');
			await createField(vendor, 'posts', 'title', 'string');
			await createField(vendor, 'posts', 'status', 'string');

			await updateCollection(vendor, 'posts', { versioning: true });

			expect(await collectionExists(vendor, `${DV}posts`)).toBe(true);
			const fields = await fieldNames(vendor, `${DV}posts`);
			expect(fields).toContain('directus_version_id');
			expect(fields).toContain('id');
			expect(fields).toContain('title');
			expect(fields).toContain('status');
		});

		it.each(vendors)('%s enabling versioning skips alias fields', async (vendor) => {
			await createCollection(vendor, 'posts');
			await createField(vendor, 'posts', 'tags', 'alias', { special: ['m2m'] }, null);

			await updateCollection(vendor, 'posts', { versioning: true });

			const fields = await fieldNames(vendor, `${DV}posts`);
			expect(fields).not.toContain('tags');
			expect(fields).not.toContain(`${DV}tags`);
		});

		it.each(vendors)('%s disabling versioning deletes version table', async (vendor) => {
			await createCollection(vendor, 'posts', { versioning: true });
			expect(await collectionExists(vendor, `${DV}posts`)).toBe(true);

			await updateCollection(vendor, 'posts', { versioning: false });
			expect(await collectionExists(vendor, `${DV}posts`)).toBe(false);
		});

		it.each(vendors)('%s enabling versioning syncs existing M2O relation', async (vendor) => {
			await createCollection(vendor, 'authors');
			await createCollection(vendor, 'posts');
			await createM2O(vendor, 'posts', 'author_id', 'authors');

			await updateCollection(vendor, 'posts', { versioning: true });

			expect(await fieldExists(vendor, `${DV}posts`, 'author_id')).toBe(true);
			expect(await relationExists(vendor, `${DV}posts`, 'author_id')).toBe(true);
			const rel = await findRelation(vendor, `${DV}posts`, 'author_id');
			expect(rel.related_collection).toBe('authors');
		});

		it.each(vendors)('%s enabling versioning syncs existing O2M alias', async (vendor) => {
			await createCollection(vendor, 'posts');
			await createCollection(vendor, 'comments');
			await createO2M(vendor, 'posts', 'comments', 'comments', 'post_id');

			await updateCollection(vendor, 'posts', { versioning: true });

			expect(await fieldExists(vendor, `${DV}posts`, `${DV}comments`)).toBe(true);
		});

		it.each(vendors)('%s enabling versioning on M-side of O2M syncs FK relation', async (vendor) => {
			await createCollection(vendor, 'posts');
			await createCollection(vendor, 'comments');
			await createO2M(vendor, 'posts', 'comments', 'comments', 'post_id');

			await updateCollection(vendor, 'comments', { versioning: true });

			expect(await collectionExists(vendor, `${DV}comments`)).toBe(true);
			expect(await fieldExists(vendor, `${DV}comments`, 'post_id')).toBe(true);
			expect(await relationExists(vendor, `${DV}comments`, 'post_id')).toBe(true);
			const rel = await findRelation(vendor, `${DV}comments`, 'post_id');
			expect(rel.related_collection).toBe('posts');
		});

		it.each(vendors)('%s enabling versioning on M-side when target is also versioned creates ref', async (vendor) => {
			await createCollection(vendor, 'posts', { versioning: true });
			await createCollection(vendor, 'comments');
			await createO2M(vendor, 'posts', 'comments', 'comments', 'post_id');

			await updateCollection(vendor, 'comments', { versioning: true });

			expect(await relationExists(vendor, `${DV}comments`, 'post_id')).toBe(true);
			expect(await fieldExists(vendor, `${DV}comments`, `${DV}post_id`)).toBe(true);
			expect(await relationExists(vendor, `${DV}comments`, `${DV}post_id`)).toBe(true);
			const refRel = await findRelation(vendor, `${DV}comments`, `${DV}post_id`);
			expect(refRel.related_collection).toBe(`${DV}posts`);
			expect(await fieldExists(vendor, `${DV}posts`, `${DV}comments`)).toBe(true);
		});

		it.each(vendors)(
			'%s enabling versioning on one-side when M-side already versioned creates alias',
			async (vendor) => {
				await createCollection(vendor, 'posts');
				await createCollection(vendor, 'comments', { versioning: true });
				await createO2M(vendor, 'posts', 'comments', 'comments', 'post_id');

				expect(await relationExists(vendor, `${DV}comments`, 'post_id')).toBe(true);

				await updateCollection(vendor, 'posts', { versioning: true });

				expect(await fieldExists(vendor, `${DV}posts`, `${DV}comments`)).toBe(true);
			},
		);

		it.each(vendors)('%s enabling versioning syncs existing M2O with both versioned', async (vendor) => {
			await createCollection(vendor, 'authors', { versioning: true });
			await createCollection(vendor, 'posts');
			await createM2O(vendor, 'posts', 'author_id', 'authors');

			await updateCollection(vendor, 'posts', { versioning: true });

			expect(await relationExists(vendor, `${DV}posts`, 'author_id')).toBe(true);
			expect(await fieldExists(vendor, `${DV}posts`, `${DV}author_id`)).toBe(true);
			expect(await relationExists(vendor, `${DV}posts`, `${DV}author_id`)).toBe(true);
			const refRel = await findRelation(vendor, `${DV}posts`, `${DV}author_id`);
			expect(refRel.related_collection).toBe(`${DV}authors`);
		});

		it.each(vendors)('%s re-enabling versioning after disable recreates version table', async (vendor) => {
			await createCollection(vendor, 'posts', { versioning: true });
			await createField(vendor, 'posts', 'title', 'string');

			await updateCollection(vendor, 'posts', { versioning: false });
			expect(await collectionExists(vendor, `${DV}posts`)).toBe(false);

			await updateCollection(vendor, 'posts', { versioning: true });
			expect(await collectionExists(vendor, `${DV}posts`)).toBe(true);
			expect(await fieldExists(vendor, `${DV}posts`, 'title')).toBe(true);
		});
	});

	// ── 3. Field CRUD on versioned collections ─────────────────────────────

	describe('Field sync on versioned collections', () => {
		it.each(vendors)('%s adding a real field syncs to version table', async (vendor) => {
			await createCollection(vendor, 'posts', { versioning: true });
			await createField(vendor, 'posts', 'title', 'string');

			expect(await fieldExists(vendor, `${DV}posts`, 'title')).toBe(true);
		});

		it.each(vendors)('%s adding an alias field does NOT sync to version table', async (vendor) => {
			await createCollection(vendor, 'posts', { versioning: true });
			await createField(vendor, 'posts', 'tags', 'alias', { special: ['m2m'] }, null);

			expect(await fieldExists(vendor, `${DV}posts`, 'tags')).toBe(false);
			expect(await fieldExists(vendor, `${DV}posts`, `${DV}tags`)).toBe(false);
		});

		it.each(vendors)('%s updating a field syncs changes to version table', async (vendor) => {
			await createCollection(vendor, 'posts', { versioning: true });
			await createField(vendor, 'posts', 'title', 'string', { note: 'original' });

			await updateField(vendor, 'posts', 'title', { meta: { note: 'updated' } });

			const dvFields = await getFields(vendor, `${DV}posts`);
			const dvTitle = dvFields.find((f: any) => f.field === 'title');
			expect(dvTitle?.meta?.note).toBe('updated');
		});

		it.each(vendors)('%s deleting a field removes it from version table', async (vendor) => {
			await createCollection(vendor, 'posts', { versioning: true });
			await createField(vendor, 'posts', 'title', 'string');
			expect(await fieldExists(vendor, `${DV}posts`, 'title')).toBe(true);

			await deleteField(vendor, 'posts', 'title');

			expect(await fieldExists(vendor, `${DV}posts`, 'title')).toBe(false);
		});

		it.each(vendors)('%s adding field to non-versioned collection does NOT create version field', async (vendor) => {
			await createCollection(vendor, 'posts');
			await createField(vendor, 'posts', 'title', 'string');

			expect(await collectionExists(vendor, `${DV}posts`)).toBe(false);
		});
	});

	// ── 4. M2O relation permutations ───────────────────────────────────────

	describe('M2O', () => {
		it.each(vendors)('%s posts[v] authors[ ] — syncs FK relation only', async (vendor) => {
			await createCollection(vendor, 'authors');
			await createCollection(vendor, 'posts', { versioning: true });
			await createM2O(vendor, 'posts', 'author_id', 'authors');

			expect(await fieldExists(vendor, `${DV}posts`, 'author_id')).toBe(true);
			expect(await relationExists(vendor, `${DV}posts`, 'author_id')).toBe(true);
			const rel = await findRelation(vendor, `${DV}posts`, 'author_id');
			expect(rel.related_collection).toBe('authors');
			expect(await fieldExists(vendor, `${DV}posts`, `${DV}author_id`)).toBe(false);

			const author = await createItem(vendor, 'authors', {});
			await createItem(vendor, 'posts', { author_id: author.id });
		});

		it.each(vendors)('%s posts[v] authors[v] — syncs FK + ref field + ref relation', async (vendor) => {
			await createCollection(vendor, 'authors', { versioning: true });
			await createCollection(vendor, 'posts', { versioning: true });
			await createM2O(vendor, 'posts', 'author_id', 'authors');

			expect(await relationExists(vendor, `${DV}posts`, 'author_id')).toBe(true);
			expect(await fieldExists(vendor, `${DV}posts`, `${DV}author_id`)).toBe(true);
			expect(await relationExists(vendor, `${DV}posts`, `${DV}author_id`)).toBe(true);
			const refRel = await findRelation(vendor, `${DV}posts`, `${DV}author_id`);
			expect(refRel.related_collection).toBe(`${DV}authors`);
			expect(refRel.meta.one_field).toBe(null);

			const author = await createItem(vendor, 'authors', {});
			await createItem(vendor, 'posts', { author_id: author.id });
		});

		it.each(vendors)('%s posts[ ] authors[v] — no sync (posts not versioned)', async (vendor) => {
			await createCollection(vendor, 'authors', { versioning: true });
			await createCollection(vendor, 'posts');
			await createM2O(vendor, 'posts', 'author_id', 'authors');

			expect(await collectionExists(vendor, `${DV}posts`)).toBe(false);
		});
	});

	// ── 5. O2M relation permutations ───────────────────────────────────────

	describe('O2M', () => {
		it.each(vendors)('%s posts[v] comments[v] — syncs FK + ref + alias', async (vendor) => {
			await createCollection(vendor, 'posts', { versioning: true });
			await createCollection(vendor, 'comments', { versioning: true });
			await createO2M(vendor, 'posts', 'comments', 'comments', 'post_id');

			expect(await fieldExists(vendor, `${DV}comments`, 'post_id')).toBe(true);
			expect(await relationExists(vendor, `${DV}comments`, 'post_id')).toBe(true);
			expect(await fieldExists(vendor, `${DV}comments`, `${DV}post_id`)).toBe(true);
			expect(await relationExists(vendor, `${DV}comments`, `${DV}post_id`)).toBe(true);
			const refRel = await findRelation(vendor, `${DV}comments`, `${DV}post_id`);
			expect(refRel.related_collection).toBe(`${DV}posts`);
			expect(await fieldExists(vendor, `${DV}posts`, `${DV}comments`)).toBe(true);
			expect(refRel.meta.one_field).toBe(`${DV}comments`);

			const post = await createItem(vendor, 'posts', {});
			await createItem(vendor, 'comments', { post_id: post.id });
		});

		it.each(vendors)('%s posts[v] comments[ ] — no sync (comments not versioned)', async (vendor) => {
			await createCollection(vendor, 'posts', { versioning: true });
			await createCollection(vendor, 'comments');
			await createO2M(vendor, 'posts', 'comments', 'comments', 'post_id');

			expect(await collectionExists(vendor, `${DV}comments`)).toBe(false);
			expect(await fieldExists(vendor, `${DV}posts`, `${DV}comments`)).toBe(false);
		});

		it.each(vendors)('%s posts[ ] comments[v] — syncs FK only, no ref or alias', async (vendor) => {
			await createCollection(vendor, 'posts');
			await createCollection(vendor, 'comments', { versioning: true });
			await createO2M(vendor, 'posts', 'comments', 'comments', 'post_id');

			expect(await fieldExists(vendor, `${DV}comments`, 'post_id')).toBe(true);
			expect(await relationExists(vendor, `${DV}comments`, 'post_id')).toBe(true);
			expect(await fieldExists(vendor, `${DV}comments`, `${DV}post_id`)).toBe(false);
			expect(await collectionExists(vendor, `${DV}posts`)).toBe(false);
		});

		it.each(vendors)('%s posts[ ] comments[ ] — no sync at all', async (vendor) => {
			await createCollection(vendor, 'posts');
			await createCollection(vendor, 'comments');
			await createO2M(vendor, 'posts', 'comments', 'comments', 'post_id');

			expect(await collectionExists(vendor, `${DV}posts`)).toBe(false);
			expect(await collectionExists(vendor, `${DV}comments`)).toBe(false);
		});
	});

	// ── 6. M2M relation permutations ───────────────────────────────────────

	describe('M2M', () => {
		it.each(vendors)('%s posts[v] tags[ ] junction[v] — syncs left FK ref, right FK plain, alias', async (vendor) => {
			await createCollection(vendor, 'posts', { versioning: true });
			await createCollection(vendor, 'tags');
			await createM2M(vendor, 'posts', 'tags', 'tags', 'posts_tags', { junctionMeta: { versioning: true } });

			expect(await collectionExists(vendor, `${DV}posts_tags`)).toBe(true);
			expect(await fieldExists(vendor, `${DV}posts`, `${DV}tags`)).toBe(true);

			expect(await relationExists(vendor, `${DV}posts_tags`, 'posts_id')).toBe(true);
			expect(await fieldExists(vendor, `${DV}posts_tags`, `${DV}posts_id`)).toBe(true);
			expect(await relationExists(vendor, `${DV}posts_tags`, `${DV}posts_id`)).toBe(true);
			const refRel = await findRelation(vendor, `${DV}posts_tags`, `${DV}posts_id`);
			expect(refRel.related_collection).toBe(`${DV}posts`);

			expect(await relationExists(vendor, `${DV}posts_tags`, 'tags_id')).toBe(true);
			const tagsRel = await findRelation(vendor, `${DV}posts_tags`, 'tags_id');
			expect(tagsRel.related_collection).toBe('tags');
			expect(await fieldExists(vendor, `${DV}posts_tags`, `${DV}tags_id`)).toBe(false);

			expect(refRel.meta.junction_field).toBe(`${DV}tags_id`);

			const p = await createItem(vendor, 'posts', {});
			const t = await createItem(vendor, 'tags', {});
			await createItem(vendor, 'posts_tags', { posts_id: p.id, tags_id: t.id });
		});

		it.each(vendors)('%s posts[v] tags[v] junction[v] — syncs both FK refs, alias', async (vendor) => {
			await createCollection(vendor, 'posts', { versioning: true });
			await createCollection(vendor, 'tags', { versioning: true });
			await createM2M(vendor, 'posts', 'tags', 'tags', 'posts_tags', { junctionMeta: { versioning: true } });

			expect(await fieldExists(vendor, `${DV}posts`, `${DV}tags`)).toBe(true);
			expect(await fieldExists(vendor, `${DV}posts_tags`, `${DV}posts_id`)).toBe(true);
			expect(await relationExists(vendor, `${DV}posts_tags`, `${DV}posts_id`)).toBe(true);
			expect(await fieldExists(vendor, `${DV}posts_tags`, `${DV}tags_id`)).toBe(true);
			expect(await relationExists(vendor, `${DV}posts_tags`, `${DV}tags_id`)).toBe(true);
			const tagsRefRel = await findRelation(vendor, `${DV}posts_tags`, `${DV}tags_id`);
			expect(tagsRefRel.related_collection).toBe(`${DV}tags`);
		});

		it.each(vendors)('%s posts[ ] tags[ ] junction[ ] — no sync at all', async (vendor) => {
			await createCollection(vendor, 'posts');
			await createCollection(vendor, 'tags');
			await createM2M(vendor, 'posts', 'tags', 'tags', 'posts_tags');

			expect(await collectionExists(vendor, `${DV}posts`)).toBe(false);
			expect(await collectionExists(vendor, `${DV}tags`)).toBe(false);
			expect(await collectionExists(vendor, `${DV}posts_tags`)).toBe(false);
		});

		it.each(vendors)('%s junction NOT versioned — no version junction even if parent versioned', async (vendor) => {
			await createCollection(vendor, 'posts', { versioning: true });
			await createCollection(vendor, 'tags');
			await createM2M(vendor, 'posts', 'tags', 'tags', 'posts_tags');

			expect(await collectionExists(vendor, `${DV}posts_tags`)).toBe(false);
		});
	});

	// ── 7. M2A relation permutations ───────────────────────────────────────

	describe('M2A', () => {
		it.each(vendors)('%s posts[v] blocks[ ] junction[v] — poly with empty versioned collections', async (vendor) => {
			await createCollection(vendor, 'posts', { versioning: true });
			await createCollection(vendor, 'blocks');
			await createM2A(vendor, 'posts', 'blocks', ['blocks'], 'posts_blocks', { junctionMeta: { versioning: true } });

			expect(await collectionExists(vendor, `${DV}posts_blocks`)).toBe(true);
			expect(await fieldExists(vendor, `${DV}posts`, `${DV}blocks`)).toBe(true);

			expect(await fieldExists(vendor, `${DV}posts_blocks`, `${DV}posts_id`)).toBe(true);
			expect(await relationExists(vendor, `${DV}posts_blocks`, `${DV}posts_id`)).toBe(true);
			const refRel = await findRelation(vendor, `${DV}posts_blocks`, `${DV}posts_id`);
			expect(refRel.related_collection).toBe(`${DV}posts`);

			const itemRel = await findRelation(vendor, `${DV}posts_blocks`, 'item');
			expect(itemRel).toBeTruthy();
			expect(itemRel.meta.one_allowed_collections).toEqual([]);
		});

		it.each(vendors)('%s posts[v] blocks[v] junction[v] — poly includes versioned target', async (vendor) => {
			await createCollection(vendor, 'posts', { versioning: true });
			await createCollection(vendor, 'blocks', { versioning: true });
			await createM2A(vendor, 'posts', 'blocks', ['blocks'], 'posts_blocks', { junctionMeta: { versioning: true } });

			expect(await fieldExists(vendor, `${DV}posts`, `${DV}blocks`)).toBe(true);

			const itemRel = await findRelation(vendor, `${DV}posts_blocks`, 'item');
			expect(itemRel).toBeTruthy();
			expect(itemRel.meta.one_allowed_collections).toEqual(['blocks', `${DV}blocks`]);
		});

		it.each(vendors)('%s posts[ ] blocks[ ] junction[ ] — no sync at all', async (vendor) => {
			await createCollection(vendor, 'posts');
			await createCollection(vendor, 'blocks');
			await createM2A(vendor, 'posts', 'blocks', ['blocks'], 'posts_blocks');

			expect(await collectionExists(vendor, `${DV}posts`)).toBe(false);
			expect(await collectionExists(vendor, `${DV}blocks`)).toBe(false);
			expect(await collectionExists(vendor, `${DV}posts_blocks`)).toBe(false);
		});
	});

	// ── 8. Relation deletion sync ──────────────────────────────────────────

	describe('Relation deletion', () => {
		it.each(vendors)('%s deleting M2O relation removes version counterpart', async (vendor) => {
			await createCollection(vendor, 'authors');
			await createCollection(vendor, 'posts', { versioning: true });
			await createM2O(vendor, 'posts', 'author_id', 'authors');

			expect(await relationExists(vendor, `${DV}posts`, 'author_id')).toBe(true);

			await deleteRelation(vendor, 'posts', 'author_id');

			expect(await relationExists(vendor, `${DV}posts`, 'author_id')).toBe(false);
		});

		it.each(vendors)(
			'%s deleting O2M FK relation removes ref relation and alias from version table',
			async (vendor) => {
				await createCollection(vendor, 'posts', { versioning: true });
				await createCollection(vendor, 'comments', { versioning: true });
				await createO2M(vendor, 'posts', 'comments', 'comments', 'post_id');

				expect(await fieldExists(vendor, `${DV}posts`, `${DV}comments`)).toBe(true);
				expect(await relationExists(vendor, `${DV}comments`, `${DV}post_id`)).toBe(true);

				await deleteRelation(vendor, 'comments', 'post_id');

				expect(await relationExists(vendor, `${DV}comments`, 'post_id')).toBe(false);
				expect(await relationExists(vendor, `${DV}comments`, `${DV}post_id`)).toBe(false);
				expect(await fieldExists(vendor, `${DV}comments`, `${DV}post_id`)).toBe(false);
				expect(await fieldExists(vendor, `${DV}posts`, `${DV}comments`)).toBe(false);
			},
		);
	});

	// ── 9. Version relation detail verification ────────────────────────────

	describe('Version relation details', () => {
		it.each(vendors)('%s M2O ref relation points FK to version PK (directus_version_id)', async (vendor) => {
			await createCollection(vendor, 'authors', { versioning: true });
			await createCollection(vendor, 'posts', { versioning: true });
			await createM2O(vendor, 'posts', 'author_id', 'authors');

			const refRel = await findRelation(vendor, `${DV}posts`, `${DV}author_id`);
			expect(refRel.schema?.foreign_key_column).toBe('directus_version_id');
			expect(refRel.schema?.foreign_key_table).toBe(`${DV}authors`);
		});

		it.each(vendors)('%s version fields have relaxed constraints (nullable, no unique)', async (vendor) => {
			await createCollection(vendor, 'posts', { versioning: true });

			await createField(
				vendor,
				'posts',
				'title',
				'string',
				{ required: true },
				{ is_nullable: false, is_unique: true },
			);

			const dvFields = await getFields(vendor, `${DV}posts`);
			const dvTitle = dvFields.find((f: any) => f.field === 'title');
			expect(dvTitle.schema.is_nullable).toBe(true);
			expect(dvTitle.schema.is_unique).toBe(false);
			expect(dvTitle.meta.required).toBe(false);
			expect(dvTitle.meta.validation).toBe(null);
		});

		it.each(vendors)('%s version PK field converted to string type', async (vendor) => {
			await createCollection(vendor, 'posts', { versioning: true });

			const dvFields = await getFields(vendor, `${DV}posts`);
			const dvId = dvFields.find((f: any) => f.field === 'id');
			expect(dvId.type).toBe('string');
			expect(dvId.schema.is_primary_key).toBe(false);
		});
	});
});
