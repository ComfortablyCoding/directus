import { describe, expect, test } from 'vitest';
import { toVersionName } from './to-version-name.js';

describe('toVersionName', () => {
	test('prefixes value with directus_versions_', () => {
		expect(toVersionName('articles')).toBe('directus_versions_articles');
	});

	test('handles already-prefixed system collections', () => {
		expect(toVersionName('directus_users')).toBe('directus_versions_directus_users');
	});

	test('handles junction table names', () => {
		expect(toVersionName('articles_directus_users')).toBe('directus_versions_articles_directus_users');
	});
});
