import { ForbiddenError, InvalidPayloadError, UnprocessableContentError } from '@directus/errors';
import type {
	AbstractServiceOptions,
	ContentVersion,
	Field,
	Item,
	MutationOptions,
	PrimaryKey,
	Query,
	RawCollection,
	RawField,
	Relation,
	Type,
} from '@directus/types';
import { cloneDeep, isNil, pick, unset } from 'lodash-es';
import emitter from '../emitter.js';
import type { Collection } from '../types/index.js';
import { getSchema } from '../utils/get-schema.js';
import { CollectionsService } from './collections.js';
import { FieldsService } from './fields.js';
import { ItemsService } from './items.js';
import { RelationsService } from './relations.js';
import { VERSION_SYSTEM_FIELDS } from './versions/constants.js';
import { toVersionedCollectionName } from './versions/to-version-collection-name.js';
import { toVersionedRelationName } from './versions/to-versioned-relation-name.js';

export class VersionsService extends ItemsService<ContentVersion> {
	constructor(collection: string, options: AbstractServiceOptions) {
		super(toVersionedCollectionName(collection), options);
	}

	private toVersionCollection<T extends RawCollection | Partial<Collection>>(payload: T): T {
		const node = cloneDeep(payload);

		if (node.collection) {
			node.collection = this.collection;
		}

		if (node.meta) {
			if (node.meta.versioned_by) {
				node.meta.versioned_by = null;
			}

			if (payload.collection) {
				node.meta.version_of = payload.collection;
			}
		}

		if ('fields' in node) {
			const fields: (RawField | Field)[] = Object.values(VERSION_SYSTEM_FIELDS);

			if (node.fields) {
				node.fields.map((f) => fields.push(this.toVersionField(f)));
			}

			node.fields = fields;
		}

		return node as T;
	}

	private toVersionField<T extends Partial<RawField | Field>>(field: T, opts?: { shadow?: boolean }): T {
		const node = cloneDeep(field);

		// Treat any existing PK as regular field
		if (node.schema?.is_primary_key === true) {
			node.schema.is_primary_key = false;
			node.schema.has_auto_increment = false;
			node.schema.is_nullable = true;
		}

		if (opts?.shadow) {
			node.field &&= toVersionedRelationName(node.field);
			node.name &&= toVersionedRelationName(node.name);
			node.collection &&= this.collection;

			if (node.meta) {
				node.meta.field &&= toVersionedRelationName(node.meta.field);
				node.meta.collection &&= this.collection;
			}

			if (node.schema) {
				node.schema.name &&= toVersionedRelationName(node.schema.name);
				node.schema.table &&= toVersionedCollectionName(node.schema.table);
				node.schema.foreign_key_column &&= VERSION_SYSTEM_FIELDS['primary'].field;
				node.schema.foreign_key_table &&= toVersionedCollectionName(node.schema.foreign_key_table);
			}
		} else {
			node.collection &&= this.collection;

			if (node.schema) {
				node.schema.table &&= toVersionedCollectionName(node.schema.table);
			}
		}

		if (node.meta) {
			// clear calculated fields
			unset(node.meta, 'id');
			unset(node.meta, 'sort');
		}

		if (node.schema?.is_unique) {
			unset(node.schema, 'is_unique');
		}

		return node as T;
	}

	private toVersionRelation(relation: Partial<Relation>, opts?: { shadow?: boolean }) {
		const node = cloneDeep(relation);

		if (opts?.shadow) {
			node.field &&= toVersionedRelationName(node.field);
			node.collection &&= this.collection;
			node.related_collection &&= toVersionedCollectionName(node.related_collection);

			if (node.schema) {
				node.schema.table &&= toVersionedCollectionName(node.schema.table);
			}
		} else {
			node.collection &&= this.collection;

			if (node.schema) {
				node.schema.table &&= toVersionedCollectionName(node.schema.table);
			}
		}

		if (node.meta?.id) {
			unset(node.meta, 'id');
		}

		return node;
	}

	async createTable(payload: RawCollection) {
		if (this.accountability && this.accountability.admin !== true) {
			throw new ForbiddenError();
		}

		if (payload.schema === null) {
			throw new InvalidPayloadError({ reason: 'Folders cannot be versioned' });
		}

		const versionPayload = this.toVersionCollection(payload);

		const collectionService = new CollectionsService({
			schema: this.schema,
			knex: this.knex,
			accountability: this.accountability,
		});

		await collectionService.createOne(versionPayload);
	}

	async createField(field: Partial<Field> & { field: string; type: Type | null }, opts?: { shadow: boolean }) {
		if (this.accountability && this.accountability.admin !== true) {
			throw new ForbiddenError();
		}

		const versionField = this.toVersionField(field, opts);

		const fieldsService = new FieldsService({
			schema: this.schema,
			knex: this.knex,
			accountability: this.accountability,
		});

		await fieldsService.createField(this.collection, versionField);
	}

	async createRelation(relation: Partial<Relation>) {
		if (this.accountability && this.accountability.admin !== true) {
			throw new ForbiddenError();
		}

		const versionPayload = this.toVersionRelation(relation);

		let relationsService = new RelationsService({
			schema: this.schema,
			knex: this.knex,
			accountability: this.accountability,
		});

		await relationsService.createOne(versionPayload);

		// create duplicate
		const fieldsService = new FieldsService({
			knex: this.knex,
			schema: this.schema,
			accountability: this.accountability,
		});

		const field = (await fieldsService.readOne(relation.collection!, relation.field!)) as Field;

		await this.createField(field, { shadow: true });

		const versionDuplicatePayload = this.toVersionRelation(relation, { shadow: true });

		// Refresh schema for field create
		relationsService = new RelationsService({
			schema: await getSchema({ database: this.knex }),
			knex: this.knex,
			accountability: this.accountability,
		});

		await relationsService.createOne(versionDuplicatePayload);
	}

	async updateTable(data: Partial<Collection>) {
		if (this.accountability && this.accountability.admin !== true) {
			throw new ForbiddenError();
		}

		const collectionService = new CollectionsService({
			schema: this.schema,
			knex: this.knex,
			accountability: this.accountability,
		});

		await collectionService.updateOne(this.collection, this.toVersionCollection(data));
	}

	async updateField(field: RawField, opts?: { shadow: boolean }) {
		if (this.accountability && this.accountability.admin !== true) {
			throw new ForbiddenError();
		}

		const versionField = this.toVersionField(field, opts);

		const fieldsService = new FieldsService({
			schema: this.schema,
			knex: this.knex,
			accountability: this.accountability,
		});

		await fieldsService.updateField(this.collection, versionField);
	}

	async updateRelation() {}

	async dropTable() {
		if (this.accountability && this.accountability.admin !== true) {
			throw new ForbiddenError();
		}

		const collectionService = new CollectionsService({
			schema: this.schema,
			knex: this.knex,
			accountability: this.accountability,
		});

		await collectionService.deleteOne(this.collection);
	}

	async deleteField(field: string) {
		if (this.accountability && this.accountability.admin !== true) {
			throw new ForbiddenError();
		}

		const fieldsService = new FieldsService({
			schema: this.schema,
			knex: this.knex,
			accountability: this.accountability,
		});

		await fieldsService.deleteField(this.collection, field);
	}

	async deleteRelation() {}

	async getMainItem(collection: string, item: PrimaryKey, query?: Query): Promise<Item> {
		const itemsService = new ItemsService(collection, {
			knex: this.knex,
			accountability: this.accountability,
			schema: this.schema,
		});

		return await itemsService.readOne(item, query);
	}

	override async createOne(data: Partial<Item>, opts?: MutationOptions): Promise<PrimaryKey> {
		if (data['shadow_key'] === 'main') throw new InvalidPayloadError({ reason: `"main" is a reserved version key` });

		const itemLess = isNil(data['item']);

		if (itemLess && data['key'] !== 'draft') {
			throw new InvalidPayloadError({ reason: `"key" must be 'draft' for versions not linked to an item` });
		}

		if (this.schema.collections[this.collection.replace('shadow_', '')]?.versionedBy === null) {
			throw new UnprocessableContentError({
				reason: `Content Versioning is not enabled for collection "${data['collection']}"`,
			});
		}

		if (!itemLess) {
			const sudoService = new VersionsService(this.collection.replace('shadow_id', ''), {
				knex: this.knex,
				schema: this.schema,
			});

			const pkField = this.schema.collections[this.collection.replace('shadow_', '')]!.primary;

			const existingVersions = await sudoService.readByQuery({
				aggregate: { count: ['*'] },
				filter: { shadow_key: { _eq: data['shadow_key'] }, [pkField]: { _eq: data[pkField] } },
			});

			if (existingVersions[0]!['count'] > 0) {
				throw new UnprocessableContentError({
					reason: `Version "${data['shadow_key']}" already exists for item "${data[pkField]}" in collection "${this.collection}"`,
				});
			}
		}

		return super.createOne(data, opts);
	}

	override async createMany(data: Partial<Item>[], opts?: MutationOptions): Promise<PrimaryKey[]> {
		if (!Array.isArray(data)) {
			throw new InvalidPayloadError({ reason: 'Input should be an array of items' });
		}

		const pkField = this.schema.collections[this.collection.replace('shadow_', '')]!.primary;
		const keyCombos = new Set();

		for (const item of data) {
			const keyCombo = `${item['shadow_key']}-${this.collection}-${item[pkField]}`;

			if (isNil(item[pkField])) continue;

			if (keyCombos.has(keyCombo)) {
				throw new UnprocessableContentError({
					reason: `Cannot create multiple versions on "${item['item']}" in collection "${item['collection']}" with the same key "${item['key']}"`,
				});
			}

			keyCombos.add(keyCombo);
		}

		return super.createMany(data, opts);
	}

	override async updateMany(keys: PrimaryKey[], data: Partial<Item>, opts?: MutationOptions): Promise<PrimaryKey[]> {
		if ('shadow_key' in data) {
			// Reserves the "main" version key for the version query parameter
			if (data['shadow_key'] === 'main') throw new InvalidPayloadError({ reason: `"main" is a reserved version key` });

			const keyCombos = new Set();

			const sudoService = new VersionsService(this.collection.replace('shadow_id', ''), {
				knex: this.knex,
				schema: this.schema,
			});

			for (const pk of keys) {
				const pkField = this.schema.collections[this.collection.replace('shadow_', '')]!.primary;
				const version = await this.readOne(pk, { fields: ['shadow_key', pkField] });

				const item = pkField in data ? data[pkField] : pkField;
				const key = 'shadow_key' in data ? data['shadow_key'] : version.shadow_key;

				if (key !== 'draft' && item === null) {
					throw new InvalidPayloadError({ reason: `"shadow_key" must be 'draft' for versions not linked to an item` });
				}

				// Skip checking for existing versions or duplicates if the version is itemless.
				if (item === null) continue;

				const keyCombo = `${key}-${this.collection}-${item}`;

				if (keyCombos.has(keyCombo)) {
					throw new UnprocessableContentError({
						reason: `Cannot update multiple versions on "${item}" in collection "${this.collection}" to the same key "${key}"`,
					});
				}

				keyCombos.add(keyCombo);

				const existingVersions = await sudoService.readByQuery({
					aggregate: { count: ['*'] },
					filter: { shadow_id: { _neq: pk }, shadow_key: { _eq: key }, [pkField]: { _eq: item } },
				});

				if (existingVersions[0]!['count'] > 0) {
					throw new UnprocessableContentError({
						reason: `Version "${data['key']}" already exists for item "${item}" in collection "${this.collection}"`,
					});
				}
			}
		}

		return super.updateMany(keys, data, opts);
	}

	async promote(versionKey: PrimaryKey, opts?: { fields?: string[] }) {
		const version = await super.readOne(versionKey);

		// adjust
		Object.keys(this.schema.collections[this.collection]!.fields).forEach((field) => {
			if (version[field as keyof ContentVersion] === null && field.startsWith('shadow_') === false) {
				const relation = this.schema.relations.find((r) => r.collection === this.collection && r.field === field);

				if (
					relation &&
					this.schema.collections[relation.related_collection!]?.primary !== field &&
					version['shadow_' + field]
				)
					version[field] = version['shadow_' + field];
			}
		});

		// remove version system fields
		Object.values(VERSION_SYSTEM_FIELDS).forEach(({ field }) => {
			unset(version, field);
		});

		const payloadToUpdate = opts?.fields ? pick(version, opts.fields) : version;

		const collection = this.collection.replace('shadow_', '');
		let pk: PrimaryKey | null = version[this.schema.collections[collection]!.primary];

		const itemsService = new ItemsService(collection, {
			accountability: this.accountability,
			knex: this.knex,
			schema: this.schema,
		});

		const payloadAfterHooks = await emitter.emitFilter(
			['items.promote', `${collection}.items.promote`],
			payloadToUpdate,
			{
				collection,
				item: pk,
				version,
			},
			{
				database: this.knex,
				schema: this.schema,
				accountability: this.accountability,
			},
		);

		if (pk) {
			await itemsService.updateOne(pk, payloadAfterHooks);
		} else {
			pk = await itemsService.createOne(payloadAfterHooks);
		}

		emitter.emitAction(
			['items.promote', `${this.collection}.items.promote`],
			{
				payload: payloadAfterHooks,
				collection: this.collection,
				item: pk,
				version: versionKey,
			},
			{
				database: this.knex,
				schema: this.schema,
				accountability: this.accountability,
			},
		);

		return pk;
	}
}
