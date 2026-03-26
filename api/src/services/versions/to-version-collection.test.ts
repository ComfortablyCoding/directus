import { InvalidPayloadError } from '@directus/errors';
import type { RawCollection, RawField } from '@directus/types';
import { describe, expect, test } from 'vitest';
import { systemVersionFields } from './constants.js';
import { toVersionCollection } from './to-version-collection.js';

function createField(name: string): RawField {
	return {
		field: name,
		type: 'string',
		schema: { is_nullable: true },
		meta: { collection: 'articles' },
	} as RawField;
}

function createAliasField(name: string): RawField {
	return {
		field: name,
		type: 'alias',
		schema: null,
		meta: { collection: 'articles', special: ['o2m'] },
	} as RawField;
}

describe('toVersionCollection', () => {
	const collection: RawCollection = {
		collection: 'articles',
		schema: {
			name: 'articles',
			comment: null,
		},
		meta: {
			collection: 'articles',
			note: null,
			hidden: false,
			singleton: false,
			versioning: false,
		},
	};

	test('throws on folder collections (schema === null)', () => {
		expect(() => toVersionCollection({ ...collection, schema: null })).toThrow(InvalidPayloadError);
	});

	test('versions collection name', () => {
		const result = toVersionCollection(collection);

		expect(result.collection).toBe('directus_versions_articles');
	});

	test('versions meta.collection', () => {
		const result = toVersionCollection(collection);

		expect(result.meta!.collection).toBe('directus_versions_articles');
	});

	test('sets versioning to false', () => {
		const result = toVersionCollection({ ...collection, meta: { ...collection.meta, versioning: true } });

		expect(result.meta!.versioning).toBe(false);
	});

	test('sets hidden to true', () => {
		const result = toVersionCollection(collection);

		expect(result.meta!.hidden).toBe(true);
	});

	test('versions schema.name', () => {
		const result = toVersionCollection(collection);

		expect(result.schema!.name).toBe('directus_versions_articles');
	});

	test('prepends system version fields', () => {
		const collectionField = createField('title');
		const result = toVersionCollection({ ...collection, fields: [collectionField] });

		expect(
			systemVersionFields.every((systemVersionFields) =>
				result.fields?.find((field) => field.field === systemVersionFields.field),
			),
		).toBeTruthy();

		expect(result.fields?.find((field) => field.field === collectionField.field)).toBeTruthy();
	});

	test('filters out alias fields', () => {
		const result = toVersionCollection({
			...collection,
			fields: [createField('title'), createAliasField('o2m'), createField('status')],
		});

		const fieldNames = (result.fields ?? []).map((f: any) => f.field);

		expect(fieldNames).toContain('directus_version_id');
		expect(fieldNames).toContain('title');
		expect(fieldNames).toContain('status');
		expect(fieldNames).not.toContain('o2m');
	});

	test('does not mutate original payload', () => {
		const original = JSON.parse(JSON.stringify(collection));

		toVersionCollection(collection);

		expect(collection).toEqual(original);
	});
});
