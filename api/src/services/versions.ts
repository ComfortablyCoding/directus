import { InvalidPayloadError, UnprocessableContentError } from '@directus/errors';
import type { AbstractServiceOptions, ContentVersion, Item, MutationOptions, PrimaryKey, Query } from '@directus/types';
import { isNil, pick, unset } from 'lodash-es';
import emitter from '../emitter.js';
import { ItemsService } from './items.js';
import { VERSION_SYSTEM_FIELDS } from './versions/constants.js';

export class VersionsService extends ItemsService<ContentVersion> {
	constructor(collection: string, options: AbstractServiceOptions) {
		super('shadow_' + collection, options);
	}

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

		if (!this.schema.collections[this.collection.replace('shadow_', '')]?.versioned) {
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
