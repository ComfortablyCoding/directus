import type { Item, PrimaryKey } from '@directus/types';

export type ContentVersion<T = Item> = {
	shadow_id: PrimaryKey;
	shadow_key: string;
	shadow_date_created: string;
	shadow_date_updated: string | null;
	shadow_user_created: string | null;
	shadow_user_updated: string | null;
} & T;
