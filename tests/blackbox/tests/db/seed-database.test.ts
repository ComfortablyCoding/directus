import { globby } from 'globby';
import { describe, expect, test } from 'vitest';
import { paths } from '../../common/config';
import { ClearCaches, DisableTestCachingSetup } from '../../common/functions';
import { sequentialTestsList } from '../../setup/sequential-tests';

describe('Seed Database Structure', async () => {
	DisableTestCachingSetup();

	let seeds = await globby('**.seed.ts', {
		cwd: paths.cwd,
	});

	if (seeds.length === 0) {
		test('No seed files found', () => {
			expect(true).toBe(true);
		});
	} else if (sequentialTestsList['db'].only.length > 0) {
		const requiredPaths = sequentialTestsList['db'].only.map((testEntry) => {
			return testEntry.slice(1).replace('.test.ts', '.seed.ts');
		});

		seeds = seeds.filter((path) => {
			return requiredPaths.includes(path);
		});
	}

	for (const path of seeds) {
		const importedTest = await import(`../../${path}`);

		if (typeof importedTest.seedDBStructure === 'function') {
			describe(`Seeding "${path}"`, async () => {
				try {
					await importedTest.seedDBStructure();
				} catch (error) {
					console.log(error);
				}
			});
		}
	}

	ClearCaches();
});
