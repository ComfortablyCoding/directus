import type { RawField } from '@directus/types';

export const systemVersionFields: RawField[] = [
	{
		field: 'directus_version_id',
		type: 'integer',
		meta: {
			interface: 'input',
		},
		schema: {
			is_primary_key: true,
			has_auto_increment: true,
		},
	},
];
