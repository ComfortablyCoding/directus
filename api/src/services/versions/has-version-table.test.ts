import { SchemaBuilder } from '@directus/schema-builder';
import { describe, expect, test } from 'vitest';
import { hasVersionTable } from './has-version-table.js';
import { toVersionName } from './to-version-name.js';

describe('hasVersionTable', () => {
	test('returns true for versioned collection', () => {
		const schema = new SchemaBuilder()
			.collection('posts', (c) => c.field('id').id())
			.options({ versioning: true })
			.build();

		expect(hasVersionTable(schema, 'posts')).toBe(true);
	});

	test('returns false for non-versioned collection', () => {
		const schema = new SchemaBuilder().collection('posts', (c) => c.field('id').id()).build();

		expect(hasVersionTable(schema, 'posts')).toBe(false);
	});

	test('returns true for junction table with version counterpart', () => {
		const schema = new SchemaBuilder()
			.collection('posts_tags', (c) => c.field('id').id())
			.collection(toVersionName('posts_tags'), (c) => c.field('id').id())
			.build();

		expect(hasVersionTable(schema, 'posts_tags')).toBe(true);
	});

	test('returns false for junction table without version counterpart', () => {
		const schema = new SchemaBuilder().collection('posts_tags', (c) => c.field('id').id()).build();

		expect(hasVersionTable(schema, 'posts_tags')).toBe(false);
	});

	test('returns false for collection not in schema', () => {
		const schema = new SchemaBuilder().collection('posts', (c) => c.field('id').id()).build();

		expect(hasVersionTable(schema, 'nonexistent')).toBe(false);
	});
});
