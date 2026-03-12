import type { ContentVersion, Field, RawField } from '@directus/types';

// TODO: Rename to directus prefix once shadow tables are supported
export const VERSION_SYSTEM_FIELDS: Record<
	'primary' | 'version' | 'user_created' | 'user_updated' | 'date_created' | 'date_updated',
	(RawField | Field) & { field: keyof ContentVersion<void> }
> = {
	primary: {
		field: 'shadow_id',
		type: 'integer',
		meta: {
			hidden: true,
			interface: 'numeric',
			readonly: true,
		},
		schema: {
			is_primary_key: true,
			has_auto_increment: true,
		},
	},
	version: {
		field: 'shadow_key',
		type: 'string',
		meta: {
			interface: 'input',
		},
		schema: {
			// TODO: Indexed?
		},
	},
	user_created: {
		field: 'shadow_user_created',
		type: 'uuid',
		meta: {
			special: ['user-created'],
			interface: 'select-dropdown-m2o',
		},
		schema: {},
	},
	user_updated: {
		field: 'shadow_user_updated',
		type: 'string',
		meta: {
			special: ['user-updated'],
			interface: 'select-dropdown-m2o',
		},
		schema: {},
	},
	date_created: {
		field: 'shadow_date_created',
		type: 'string',
		meta: {
			special: ['date-created'],
			interface: 'datetime',
		},
		schema: {},
	},
	date_updated: {
		field: 'shadow_date_updated',
		type: 'string',
		meta: {
			special: ['date-updated'],
			interface: 'datetime',
		},
		schema: {},
	},
};
