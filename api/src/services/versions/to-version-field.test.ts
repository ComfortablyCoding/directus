import type { Field } from '@directus/types';
import { describe, expect, test } from 'vitest';
import { toVersionField } from './to-version-field.js';

function createField(overrides: Partial<Field> = {}): Field {
	return {
		collection: 'articles',
		field: 'title',
		type: 'string',
		schema: {
			table: 'articles',
			name: 'title',
			data_type: 'varchar',
			default_value: null,
			max_length: 255,
			numeric_precision: null,
			numeric_scale: null,
			is_generated: false,
			generation_expression: null,
			is_nullable: false,
			is_unique: true,
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
			collection: 'articles',
			field: 'title',
			special: null,
			interface: 'input',
			options: null,
			display: null,
			display_options: null,
			readonly: false,
			hidden: false,
			sort: 2,
			width: 'full',
			translations: null,
			note: null,
			conditions: [{ rule: {} }],
			required: true,
			group: null,
			validation: { _and: [{ title: { _nnull: true } }] },
			validation_message: 'Title is required',
		},
		...overrides,
	} as Field;
}

function createAliasField(overrides: Partial<Field> = {}): Field {
	return {
		collection: 'articles',
		field: 'o2m',
		type: 'alias',
		schema: null,
		meta: {
			id: 2,
			collection: 'articles',
			field: 'o2m',
			special: ['o2m'],
			interface: 'list-o2m',
			options: null,
			display: null,
			display_options: null,
			readonly: false,
			hidden: false,
			sort: 3,
			width: 'full',
			translations: null,
			note: null,
			conditions: null,
			required: false,
			group: null,
			validation: null,
			validation_message: null,
		},
		...overrides,
	} as Field;
}

describe('toVersionField', () => {
	test('versions collection name', () => {
		const result = toVersionField(createField());

		expect(result.collection).toBe('directus_versions_articles');
	});

	test('versions meta.collection', () => {
		const result = toVersionField(createField());

		expect(result.meta!.collection).toBe('directus_versions_articles');
	});

	test('versions schema.table', () => {
		const result = toVersionField(createField());

		expect(result.schema!.table).toBe('directus_versions_articles');
	});

	test('removes meta.id and meta.sort', () => {
		const result = toVersionField(createField());

		expect(result.meta).not.toHaveProperty('id');
		expect(result.meta).not.toHaveProperty('sort');
	});

	test('relaxes constraints', () => {
		const result = toVersionField(createField());

		expect(result.schema!.is_nullable).toBe(true);
		expect(result.schema!.is_unique).toBe(false);
		expect(result.schema!.is_primary_key).toBe(false);
	});

	test('removes validation', () => {
		const result = toVersionField(createField());

		expect(result.meta!.required).toBe(false);
		expect(result.meta!.validation).toBeNull();
		expect(result.meta!.validation_message).toBeNull();
		expect(result.meta!.conditions).toBeNull();
	});

	test('converts primary key to plain string field', () => {
		const field = createField({
			schema: {
				...createField().schema!,
				is_primary_key: true,
			},
		});

		const result = toVersionField(field);

		expect(result.type).toBe('string');
		expect(result.meta!.interface).toBe('input');
		expect(result.schema!.is_primary_key).toBe(false);
		expect(result.schema!.has_auto_increment).toBe(false);
	});

	test('does not mutate original payload', () => {
		const field = createField();
		const original = JSON.parse(JSON.stringify(field));

		toVersionField(field);

		expect(field).toEqual(original);
	});

	describe('alias fields', () => {
		test('versions collection name', () => {
			const result = toVersionField(createAliasField());

			expect(result.collection).toBe('directus_versions_articles');
		});

		test('versions meta.collection', () => {
			const result = toVersionField(createAliasField());

			expect(result.meta!.collection).toBe('directus_versions_articles');
		});

		test('preserves null schema', () => {
			const result = toVersionField(createAliasField());

			expect(result.schema).toBeNull();
		});

		test('preserves meta.special', () => {
			const result = toVersionField(createAliasField());

			expect(result.meta!.special).toEqual(['o2m']);
		});

		test('removes meta.id and meta.sort', () => {
			const result = toVersionField(createAliasField());

			expect(result.meta).not.toHaveProperty('id');
			expect(result.meta).not.toHaveProperty('sort');
		});

		test('versions field name with reference', () => {
			const result = toVersionField(createAliasField(), { reference: true });

			expect(result.field).toBe('directus_versions_o2m');
			expect(result.meta!.field).toBe('directus_versions_o2m');
		});

		test('does not mutate original payload', () => {
			const field = createAliasField();
			const original = JSON.parse(JSON.stringify(field));

			toVersionField(field, { reference: true });

			expect(field).toEqual(original);
		});
	});

	describe('reference mode', () => {
		test('versions field name', () => {
			const result = toVersionField(createField(), { reference: true });

			expect(result.field).toBe('directus_versions_title');
		});

		test('versions meta.field', () => {
			const result = toVersionField(createField(), { reference: true });

			expect(result.meta!.field).toBe('directus_versions_title');
		});

		test('versions schema.name', () => {
			const result = toVersionField(createField(), { reference: true });

			expect(result.schema!.name).toBe('directus_versions_title');
		});

		test('does not version field name without reference', () => {
			const result = toVersionField(createField());

			expect(result.field).toBe('title');
		});
	});
});
