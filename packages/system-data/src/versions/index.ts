import versionSystemFieldsData from './version-system-fields.yaml';

export type VersionSystemField = {
	field: string;
	type: string;
	meta: Record<string, any>;
	schema: Record<string, any>;
};

export const versionSystemFields = versionSystemFieldsData as Record<
	'primary' | 'version' | 'user_created' | 'user_updated' | 'date_created' | 'date_updated',
	VersionSystemField
>;
