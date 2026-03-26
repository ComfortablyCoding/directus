import { SchemaBuilder } from '@directus/schema-builder';
import { getRelation } from '@directus/utils';
import { describe, expect, test } from 'vitest';
import { toVersionRelation } from './to-version-relation.js';

const v = (name: string) => `directus_versions_${name}`;

const schema = new SchemaBuilder()
	.collection('articles', (c) => {
		c.field('id').id();
		c.field('m2o').m2o('directus_users');
		c.field('o2m').o2m('directus_users', 'article_id');
		c.field('m2m').m2m('directus_users');
		c.field('m2a').m2a(['directus_users']);
	})
	.collection('directus_users', (c) => {
		c.field('id').id();
	})
	.build();

const m2oRelation = getRelation(schema.relations, 'articles', 'm2o')!;
const o2mRelation = getRelation(schema.relations, 'articles', 'o2m')!;

// M2M produces two relations: left (junction → articles) and right (junction → directus_users)
const m2mLeftRelation = getRelation(schema.relations, 'articles', 'm2m')!;
const m2mRightRelation = getRelation(schema.relations, 'articles_directus_users_junction', 'directus_users_id')!;

// M2A produces two relations: FK (junction → articles) and item (junction → polymorphic)
const m2aFkRelation = getRelation(schema.relations, 'articles', 'm2a')!;
const m2aItemRelation = getRelation(schema.relations, 'articles_builder', 'item')!;

describe('toVersionRelation', () => {
	test('does not mutate original payload', () => {
		const original = JSON.parse(JSON.stringify(m2oRelation));

		toVersionRelation(m2oRelation);

		expect(m2oRelation).toEqual(original);
	});

	describe('M2O', () => {
		test('versions collection side', () => {
			const result = toVersionRelation(m2oRelation);

			expect(result.collection).toBe(v('articles'));
			expect(result.schema!.table).toBe(v('articles'));
			expect(result.meta!.many_collection).toBe(v('articles'));
		});

		test('does not version related side without reference', () => {
			const result = toVersionRelation(m2oRelation);

			expect(result.related_collection).toBe('directus_users');
			expect(result.field).toBe('m2o');
			expect(result.schema!.column).toBe('m2o');
			expect(result.schema!.foreign_key_table).toBe('directus_users');
			expect(result.meta!.one_collection).toBe('directus_users');
		});

		test('removes meta.id', () => {
			const result = toVersionRelation(m2oRelation);

			expect(result.meta).not.toHaveProperty('id');
		});

		test('versions related side with reference', () => {
			const result = toVersionRelation(m2oRelation, { reference: true });

			expect(result.collection).toBe(v('articles'));
			expect(result.related_collection).toBe(v('directus_users'));
			expect(result.field).toBe(v('m2o'));
			expect(result.schema!.column).toBe(v('m2o'));
			expect(result.schema!.foreign_key_table).toBe(v('directus_users'));
			expect(result.schema!.foreign_key_column).toBe('directus_version_id');
			expect(result.meta!.one_collection).toBe(v('directus_users'));
		});
	});

	describe('O2M', () => {
		test('versions both sides with reference (O2M detection skipped)', () => {
			const result = toVersionRelation(o2mRelation, { reference: true });

			expect(result.collection).toBe(v('directus_users'));
			expect(result.schema!.table).toBe(v('directus_users'));
			expect(result.meta!.many_collection).toBe(v('directus_users'));

			expect(result.field).toBe(v('article_id'));
			expect(result.schema!.column).toBe(v('article_id'));
			expect(result.meta!.many_field).toBe(v('article_id'));

			expect(result.related_collection).toBe(v('articles'));
			expect(result.schema!.foreign_key_table).toBe(v('articles'));
			expect(result.schema!.foreign_key_column).toBe('directus_version_id');
			expect(result.meta!.one_collection).toBe(v('articles'));
			expect(result.meta!.one_field).toBe(v('o2m'));
		});

		test('removes meta.id', () => {
			const result = toVersionRelation(o2mRelation, { reference: true });

			expect(result.meta).not.toHaveProperty('id');
		});

		test('does not version anything without reference', () => {
			const result = toVersionRelation(o2mRelation);

			expect(result.collection).toBe('directus_users');
			expect(result.related_collection).toBe('articles');
			expect(result.field).toBe('article_id');
			expect(result.schema!.table).toBe('directus_users');
		});
	});

	describe('M2M right (junction → target)', () => {
		test('versions collection/junction side', () => {
			const result = toVersionRelation(m2mRightRelation);

			expect(result.collection).toBe(v('articles_directus_users_junction'));
			expect(result.schema!.table).toBe(v('articles_directus_users_junction'));
			expect(result.meta!.many_collection).toBe(v('articles_directus_users_junction'));
		});

		test('does not version related side without reference', () => {
			const result = toVersionRelation(m2mRightRelation);

			expect(result.related_collection).toBe('directus_users');
			expect(result.field).toBe('directus_users_id');
			expect(result.schema!.foreign_key_table).toBe('directus_users');
			expect(result.meta!.one_collection).toBe('directus_users');
			expect(result.meta!.junction_field).toBe('articles_id');
		});

		test('versions related side with reference', () => {
			const result = toVersionRelation(m2mRightRelation, { reference: true });

			expect(result.related_collection).toBe(v('directus_users'));
			expect(result.field).toBe(v('directus_users_id'));
			expect(result.schema!.column).toBe(v('directus_users_id'));
			expect(result.schema!.foreign_key_table).toBe(v('directus_users'));
			expect(result.schema!.foreign_key_column).toBe('directus_version_id');
			expect(result.meta!.one_collection).toBe(v('directus_users'));
			expect(result.meta!.junction_field).toBe(v('articles_id'));
		});
	});

	describe('M2M left (junction → versioned target)', () => {
		test('versions both collection and related sides with reference', () => {
			const result = toVersionRelation(m2mLeftRelation, { reference: true });

			// Collection/junction side
			expect(result.collection).toBe(v('articles_directus_users_junction'));
			expect(result.schema!.table).toBe(v('articles_directus_users_junction'));
			expect(result.meta!.many_collection).toBe(v('articles_directus_users_junction'));

			// Related side
			expect(result.related_collection).toBe(v('articles'));
			expect(result.schema!.foreign_key_table).toBe(v('articles'));
			expect(result.schema!.foreign_key_column).toBe('directus_version_id');
			expect(result.meta!.one_collection).toBe(v('articles'));
		});

		test('renames field/column and junction_field', () => {
			const result = toVersionRelation(m2mLeftRelation, { reference: true });

			expect(result.field).toBe(v('articles_id'));
			expect(result.schema!.column).toBe(v('articles_id'));
			expect(result.meta!.many_field).toBe(v('articles_id'));
			expect(result.meta!.junction_field).toBe(v('directus_users_id'));
		});

		test('versions one_field alias', () => {
			const result = toVersionRelation(m2mLeftRelation, { reference: true });

			expect(result.meta!.one_field).toBe(v('m2m'));
		});
	});

	describe('M2A item (junction → polymorphic)', () => {
		test('versions collection/junction side', () => {
			const result = toVersionRelation(m2aItemRelation);

			expect(result.collection).toBe(v('articles_builder'));
			expect(result.meta!.many_collection).toBe(v('articles_builder'));
		});

		test('does not touch null schema', () => {
			const result = toVersionRelation(m2aItemRelation);

			expect(result.schema).toBeNull();
		});

		test('filters one_allowed_collections to versioned targets when versionedCollections provided', () => {
			const result = toVersionRelation(m2aItemRelation, {
				reference: false,
				versionedCollections: ['directus_users'],
			});

			// directus_users is in the versioned list → included with version name
			expect(result.meta!.one_allowed_collections).toEqual(['directus_users', v('directus_users')]);
		});

		test('excludes non-versioned targets from one_allowed_collections', () => {
			const result = toVersionRelation(m2aItemRelation, {
				reference: false,
				versionedCollections: [],
			});

			// no versioned collections → empty list
			expect(result.meta!.one_allowed_collections).toEqual([]);
		});

		test('preserves one_allowed_collections without versionedCollections opt', () => {
			const result = toVersionRelation(m2aItemRelation);

			expect(result.meta!.one_allowed_collections).toEqual(['directus_users']);
		});

		test('removes meta.id', () => {
			const result = toVersionRelation(m2aItemRelation);

			expect(result.meta).not.toHaveProperty('id');
		});

		test('renames field and junction_field with reference', () => {
			const result = toVersionRelation(m2aItemRelation, { reference: true });

			expect(result.field).toBe(v('item'));
			expect(result.meta!.many_field).toBe(v('item'));
			expect(result.meta!.junction_field).toBe(v('articles_id'));
		});
	});

	describe('M2A FK (junction → versioned parent)', () => {
		test('versions both sides with reference', () => {
			const result = toVersionRelation(m2aFkRelation, { reference: true });

			// Collection/junction side
			expect(result.collection).toBe(v('articles_builder'));
			expect(result.schema!.table).toBe(v('articles_builder'));
			expect(result.meta!.many_collection).toBe(v('articles_builder'));

			// Related side
			expect(result.related_collection).toBe(v('articles'));
			expect(result.schema!.foreign_key_table).toBe(v('articles'));
			expect(result.schema!.foreign_key_column).toBe('directus_version_id');
			expect(result.meta!.one_collection).toBe(v('articles'));
		});

		test('renames field/column and junction_field', () => {
			const result = toVersionRelation(m2aFkRelation, { reference: true });

			expect(result.field).toBe(v('articles_id'));
			expect(result.schema!.column).toBe(v('articles_id'));
			expect(result.meta!.many_field).toBe(v('articles_id'));
			expect(result.meta!.junction_field).toBe(v('item'));
		});

		test('versions one_field alias', () => {
			const result = toVersionRelation(m2aFkRelation, { reference: true });

			expect(result.meta!.one_field).toBe(v('m2a'));
		});

		test('only versions collection side without reference', () => {
			const result = toVersionRelation(m2aFkRelation);

			expect(result.collection).toBe(v('articles_builder'));
			expect(result.related_collection).toBe('articles');
			expect(result.field).toBe('articles_id');
			expect(result.schema!.foreign_key_table).toBe('articles');
		});
	});
});
