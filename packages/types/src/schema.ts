import type { Type } from './fields.js';
import type { Filter } from './filter.js';
import type { Relation } from './relations.js';

export type FieldOverview = {
	field: string;
	defaultValue: any;
	nullable: boolean;
	generated: boolean;
	type: Type;
	dbType: string | null;
	precision: number | null;
	scale: number | null;
	special: string[];
	note: string | null;
	validation: Filter | null;
	alias: boolean;
	searchable: boolean;
	// The reference field if this is a versioned field (e.g. version_author -> author)
	versionOf: string | null;
	// The versioned field for this field (e.g. author -> version_author)
	versionedBy: string | null;
};

export type CollectionOverview = {
	collection: string;
	primary: string;
	singleton: boolean;
	sortField: string | null;
	note: string | null;
	accountability: 'all' | 'activity' | null;
	// The reference collection if this is a versioned collection (e.g. version_authors -> authors)
	versionOf: string | null;
	// The versioned collection for this collection (e.g. authors -> version_authors)
	versionedBy: string | null;
	fields: {
		[name: string]: FieldOverview;
	};
};

export type CollectionsOverview = {
	[name: string]: CollectionOverview;
};

export type SchemaOverview = {
	collections: CollectionsOverview;
	relations: Relation[];
};
