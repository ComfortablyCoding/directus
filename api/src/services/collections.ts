import { useEnv } from '@directus/env';
import { ForbiddenError, InvalidPayloadError } from '@directus/errors';
import type { SchemaInspector } from '@directus/schema';
import { createInspector } from '@directus/schema';
import { type BaseCollectionMeta, systemCollectionRows } from '@directus/system-data';
import type {
	AbstractServiceOptions,
	Accountability,
	ActionEventParams,
	FieldMeta,
	FieldMutationOptions,
	MutationOptions,
	RawCollection,
	RawField,
	SchemaOverview,
} from '@directus/types';
import { addFieldFlag } from '@directus/utils';
import type Keyv from 'keyv';
import type { Knex } from 'knex';
import { chunk, groupBy, merge, omit } from 'lodash-es';
import { clearSystemCache, getCache } from '../cache.js';
import { ALIAS_TYPES } from '../constants.js';
import type { Helpers } from '../database/helpers/index.js';
import { getHelpers } from '../database/helpers/index.js';
import getDatabase, { getSchemaInspector } from '../database/index.js';
import emitter from '../emitter.js';
import { fetchAllowedCollections } from '../permissions/modules/fetch-allowed-collections/fetch-allowed-collections.js';
import { validateAccess } from '../permissions/modules/validate-access/validate-access.js';
import type { Collection } from '../types/index.js';
import { getSchema } from '../utils/get-schema.js';
import { shouldClearCache } from '../utils/should-clear-cache.js';
import { transaction } from '../utils/transaction.js';
import { buildCollectionAndFieldRelations } from './fields/build-collection-and-field-relations.js';
import { getCollectionMetaUpdates } from './fields/get-collection-meta-updates.js';
import { getCollectionRelationList } from './fields/get-collection-relation-list.js';
import { FieldsService } from './fields.js';
import { ItemsService } from './items.js';
import { RelationsService } from './relations.js';
import { hasVersionTable } from './versions/has-version-table.js';
import { toVersionCollection } from './versions/to-version-collection.js';
import { toVersionField } from './versions/to-version-field.js';
import { toVersionName } from './versions/to-version-name.js';
import { toVersionRelation } from './versions/to-version-relation.js';

export class CollectionsService {
	knex: Knex;
	helpers: Helpers;
	accountability: Accountability | null;
	schemaInspector: SchemaInspector;
	schema: SchemaOverview;
	cache: Keyv<any> | null;
	systemCache: Keyv<any>;

	constructor(options: AbstractServiceOptions) {
		this.knex = options.knex || getDatabase();
		this.helpers = getHelpers(this.knex);
		this.accountability = options.accountability || null;
		this.schemaInspector = options.knex ? createInspector(options.knex) : getSchemaInspector();
		this.schema = options.schema;

		const { cache, systemCache } = getCache();
		this.cache = cache;
		this.systemCache = systemCache;
	}

	/**
	 * Create a single new collection
	 */
	async createOne(payload: RawCollection, opts?: FieldMutationOptions): Promise<string> {
		if (this.accountability && this.accountability.admin !== true) {
			throw new ForbiddenError();
		}

		if (!('collection' in payload)) throw new InvalidPayloadError({ reason: `"collection" is required` });

		if (typeof payload.collection !== 'string' || payload.collection === '') {
			throw new InvalidPayloadError({ reason: `"collection" must be a non-empty string` });
		}

		if (payload.collection.startsWith('directus_') && !payload.collection.startsWith('directus_versions_')) {
			throw new InvalidPayloadError({ reason: `Collections can't start with "directus_"` });
		}

		payload.collection = await this.helpers.schema.parseCollectionName(payload.collection);

		const nestedActionEvents: ActionEventParams[] = [];

		try {
			const existingCollections: string[] = [
				...((await this.knex.select('collection').from('directus_collections'))?.map(({ collection }) => collection) ??
					[]),
				...Object.keys(this.schema.collections),
			];

			if (existingCollections.includes(payload.collection)) {
				throw new InvalidPayloadError({ reason: `Collection "${payload.collection}" already exists` });
			}

			const attemptConcurrentIndex = Boolean(opts?.attemptConcurrentIndex);

			// Create the collection/fields in a transaction so it'll be reverted in case of errors or
			// permission problems. This might not work reliably in MySQL, as it doesn't support DDL in
			// transactions.
			await transaction(this.knex, async (trx) => {
				if (payload.schema) {
					if ('fields' in payload && !Array.isArray(payload.fields)) {
						throw new InvalidPayloadError({ reason: `"fields" must be an array` });
					}

					/**
					 * Directus heavily relies on the primary key of a collection, so we have to make sure that
					 * every collection that is created has a primary key. If no primary key field is created
					 * while making the collection, we default to an auto incremented id named `id`
					 */

					const injectedPrimaryKeyField: RawField = {
						field: 'id',
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
					};

					if (!payload.fields || payload.fields.length === 0) {
						payload.fields = [injectedPrimaryKeyField];
					} else if (
						!payload.fields.some((f) => f.schema?.is_primary_key === true || f.schema?.has_auto_increment === true)
					) {
						payload.fields = [injectedPrimaryKeyField, ...payload.fields];
					}

					// Ensure that every field meta has the field/collection fields filled correctly
					payload.fields = payload.fields.map((field) => {
						if (field.meta) {
							field.meta = {
								...field.meta,
								field: field.field,
								collection: payload.collection!,
							};
						}

						// Add flag for specific database type overrides
						const flagToAdd = this.helpers.date.fieldFlagForField(field.type);

						if (flagToAdd) {
							addFieldFlag(field, flagToAdd);
						}

						return field;
					});

					const fieldsService = new FieldsService({ knex: trx, schema: this.schema });

					await trx.schema.createTable(payload.collection, (table) => {
						for (const field of payload.fields!) {
							if (field.type && ALIAS_TYPES.includes(field.type) === false) {
								fieldsService.addColumnToTable(table, payload.collection, field, {
									attemptConcurrentIndex,
								});
							}
						}
					});

					const fieldItemsService = new ItemsService('directus_fields', {
						knex: trx,
						accountability: this.accountability,
						schema: this.schema,
					});

					const fieldPayloads = payload.fields!.filter((field) => field.meta).map((field) => field.meta) as FieldMeta[];

					// Sort new fields that does not have any group defined, in ascending order.
					// Lodash merge is used so that the "sort" can be overridden if defined.
					let sortedFieldPayloads = fieldPayloads
						.filter((field) => field?.group === undefined || field?.group === null)
						.map((field, index) => merge({ sort: index + 1 }, field));

					// Sort remaining new fields with group defined, if any, in ascending order.
					// sortedFieldPayloads will be less than fieldPayloads if it filtered out any fields with group defined.
					if (sortedFieldPayloads.length < fieldPayloads.length) {
						const fieldsWithGroups = groupBy(
							fieldPayloads.filter((field) => field?.group),
							(field) => field?.group,
						);

						// The sort order is restarted from 1 for fields in each group and appended to sortedFieldPayloads.
						// Lodash merge is used so that the "sort" can be overridden if defined.
						for (const [_group, fields] of Object.entries(fieldsWithGroups)) {
							sortedFieldPayloads = sortedFieldPayloads.concat(
								fields.map((field, index) => merge({ sort: index + 1 }, field)),
							);
						}
					}

					await fieldItemsService.createMany(sortedFieldPayloads, {
						bypassEmitAction: (params) =>
							opts?.bypassEmitAction ? opts.bypassEmitAction(params) : nestedActionEvents.push(params),
						bypassLimits: true,
					});
				}

				if (payload.meta) {
					const collectionsItemsService = new ItemsService('directus_collections', {
						knex: trx,
						accountability: this.accountability,
						schema: this.schema,
					});

					await collectionsItemsService.createOne(
						{
							...payload.meta,
							collection: payload.collection,
						},
						{
							bypassEmitAction: (params) =>
								opts?.bypassEmitAction ? opts.bypassEmitAction(params) : nestedActionEvents.push(params),
						},
					);
				}

				/**
				 * Versioning sync — create version table when collection has versioning enabled.
				 * Inside the same transaction so both tables are created atomically.
				 *
				 * Note: version tables have versioning=false so this does not recurse.
				 */
				if (payload.meta?.versioning && payload.schema) {
					const collectionsService = new CollectionsService({ knex: trx, schema: this.schema });
					await collectionsService.createOne(toVersionCollection(payload));
				}

				return payload.collection;
			});

			// concurrent index creation cannot be done inside the transaction
			if (attemptConcurrentIndex && payload.schema && Array.isArray(payload.fields)) {
				const fieldsService = new FieldsService({ schema: this.schema });

				for (const field of payload.fields) {
					if (field.type && ALIAS_TYPES.includes(field.type) === false) {
						await fieldsService.addColumnIndex(payload.collection, field, {
							attemptConcurrentIndex,
						});
					}
				}
			}

			return payload.collection;
		} finally {
			if (shouldClearCache(this.cache, opts)) {
				await this.cache.clear();
			}

			if (opts?.autoPurgeSystemCache !== false) {
				await clearSystemCache({ autoPurgeCache: opts?.autoPurgeCache });
			}

			if (opts?.emitEvents !== false && nestedActionEvents.length > 0) {
				const updatedSchema = await getSchema({ database: this.knex });

				for (const nestedActionEvent of nestedActionEvents) {
					nestedActionEvent.context.schema = updatedSchema;
					emitter.emitAction(nestedActionEvent.event, nestedActionEvent.meta, nestedActionEvent.context);
				}
			}
		}
	}

	/**
	 * Create multiple new collections
	 */
	async createMany(payloads: RawCollection[], opts?: FieldMutationOptions): Promise<string[]> {
		const nestedActionEvents: ActionEventParams[] = [];

		try {
			const collections = await transaction(this.knex, async (trx) => {
				const service = new CollectionsService({
					schema: this.schema,
					accountability: this.accountability,
					knex: trx,
				});

				const collectionNames: string[] = [];

				for (const payload of payloads) {
					const name = await service.createOne(payload, {
						autoPurgeCache: false,
						autoPurgeSystemCache: false,
						bypassEmitAction: (params) => nestedActionEvents.push(params),
						attemptConcurrentIndex: Boolean(opts?.attemptConcurrentIndex),
					});

					collectionNames.push(name);
				}

				return collectionNames;
			});

			return collections;
		} finally {
			if (shouldClearCache(this.cache, opts)) {
				await this.cache.clear();
			}

			if (opts?.autoPurgeSystemCache !== false) {
				await clearSystemCache({ autoPurgeCache: opts?.autoPurgeCache });
			}

			if (opts?.emitEvents !== false && nestedActionEvents.length > 0) {
				const updatedSchema = await getSchema({ database: this.knex });

				for (const nestedActionEvent of nestedActionEvents) {
					nestedActionEvent.context.schema = updatedSchema;
					emitter.emitAction(nestedActionEvent.event, nestedActionEvent.meta, nestedActionEvent.context);
				}
			}
		}
	}

	/**
	 * Read all collections. Currently doesn't support any query.
	 */
	async readByQuery(): Promise<Collection[]> {
		const env = useEnv();

		const collectionsItemsService = new ItemsService('directus_collections', {
			knex: this.knex,
			schema: this.schema,
			accountability: this.accountability,
		});

		let tablesInDatabase = await this.schemaInspector.tableInfo();

		let meta = (await collectionsItemsService.readByQuery({
			limit: -1,
		})) as BaseCollectionMeta[];

		meta.push(...systemCollectionRows);

		if (this.accountability && this.accountability.admin !== true) {
			const collectionsGroups: { [key: string]: string } = meta.reduce(
				(meta, item) => ({
					...meta,
					[item.collection]: item.group,
				}),
				{},
			);

			let collectionsYouHavePermissionToRead = await fetchAllowedCollections(
				{
					accountability: this.accountability,
					action: 'read',
				},
				{
					knex: this.knex,
					schema: this.schema,
				},
			);

			for (const collection of collectionsYouHavePermissionToRead) {
				const group = collectionsGroups[collection];
				if (group) collectionsYouHavePermissionToRead.push(group);
				delete collectionsGroups[collection];
			}

			collectionsYouHavePermissionToRead = [...new Set([...collectionsYouHavePermissionToRead])];

			tablesInDatabase = tablesInDatabase.filter((table) => {
				return collectionsYouHavePermissionToRead.includes(table.name);
			});

			meta = meta.filter((collectionMeta) => {
				return collectionsYouHavePermissionToRead.includes(collectionMeta.collection);
			});
		}

		const collections: Collection[] = [];

		for (const collectionMeta of meta) {
			const collection: Collection = {
				collection: collectionMeta.collection,
				meta: collectionMeta,
				schema: tablesInDatabase.find((table) => table.name === collectionMeta.collection) ?? null,
			};

			collections.push(collection);
		}

		for (const table of tablesInDatabase) {
			const exists = !!collections.find(({ collection }) => collection === table.name);

			if (!exists) {
				collections.push({
					collection: table.name,
					schema: table,
					meta: null,
				});
			}
		}

		if (env['DB_EXCLUDE_TABLES']) {
			return collections.filter(
				(collection) => (env['DB_EXCLUDE_TABLES'] as string[]).includes(collection.collection) === false,
			);
		}

		return collections;
	}

	/**
	 * Get a single collection by name
	 */
	async readOne(collectionKey: string): Promise<Collection> {
		const result = await this.readMany([collectionKey]);

		if (result.length === 0) throw new ForbiddenError();

		return result[0]!;
	}

	/**
	 * Read many collections by name
	 */
	async readMany(collectionKeys: string[]): Promise<Collection[]> {
		if (this.accountability) {
			await Promise.all(
				collectionKeys.map((collection) =>
					validateAccess(
						{
							accountability: this.accountability!,
							action: 'read',
							collection,
							skipCollectionExistsCheck: true,
						},
						{
							schema: this.schema,
							knex: this.knex,
						},
					),
				),
			);
		}

		const collections = await this.readByQuery();
		return collections.filter(({ collection }) => collectionKeys.includes(collection));
	}

	/**
	 * Update a single collection by name
	 */
	async updateOne(collectionKey: string, data: Partial<Collection>, opts?: MutationOptions): Promise<string> {
		if (this.accountability && this.accountability.admin !== true) {
			throw new ForbiddenError();
		}

		const nestedActionEvents: ActionEventParams[] = [];

		try {
			const payload = data as Partial<Collection>;

			if (!payload.meta) {
				return collectionKey;
			}

			await transaction(this.knex, async (trx) => {
				const collectionsItemsService = new ItemsService('directus_collections', {
					knex: trx,
					accountability: this.accountability,
					schema: this.schema,
				});

				const exists = !!(await trx
					.select('collection')
					.from('directus_collections')
					.where({ collection: collectionKey })
					.first());

				if (exists) {
					await collectionsItemsService.updateOne(collectionKey, payload.meta!, {
						...opts,
						bypassEmitAction: (params) =>
							opts?.bypassEmitAction ? opts.bypassEmitAction(params) : nestedActionEvents.push(params),
					});
				} else {
					await collectionsItemsService.createOne(
						{ ...payload.meta, collection: collectionKey },
						{
							...opts,
							bypassEmitAction: (params) =>
								opts?.bypassEmitAction ? opts.bypassEmitAction(params) : nestedActionEvents.push(params),
						},
					);
				}

				/**
				 * Versioning sync — handle versioning toggle.
				 *
				 * When versioning is enabled:
				 *   1. Create the version table (mirrors real fields, skips aliases)
				 *   2. Retroactively sync all existing relations that involve this collection
				 *      (FK relations where collection=this, alias relations where one_collection=this)
				 *
				 * When versioning is disabled:
				 *   Delete the version table and all its contents.
				 *
				 * All within the same transaction so the meta update and version sync are atomic.
				 */
				if ('versioning' in payload.meta!) {
					const wasVersioned = this.schema.collections[collectionKey]?.versioning;
					const isVersioned = payload.meta!.versioning;

					if (isVersioned && !wasVersioned) {
						const collectionsService = new CollectionsService({ knex: trx, schema: this.schema });

						const existing = await collectionsService.readOne(collectionKey);

						if (existing.schema) {
							// Step 2: add existing real fields via FieldsService (triggers per-field version sync)
							const fieldsService = new FieldsService({ knex: trx, schema: this.schema });
							const existingFields = await fieldsService.readAll(collectionKey);

							if (!existing.fields) existing.fields = [];

							for (const field of existingFields) {
								if (!field.schema) continue;

								existing.fields.push(toVersionField(field));
							}

							// Step 1: create bare version table (system version fields only)
							await collectionsService.createOne(toVersionCollection(existing));

							// Step 3: sync existing relations to version table via createOne
							const refreshedSchema = await getSchema({ bypassCache: true, database: trx });

							const relationsService = new RelationsService({
								knex: trx,
								schema: refreshedSchema,
							});

							for (const relation of this.schema.relations) {
								// Skip if no m2o on this collection or o2m pointing here
								if (relation.collection !== collectionKey && relation.meta?.one_collection !== collectionKey) continue;

								// Build version payload and create through normal flow
								const fkRelation = {
									...relation,
									meta: relation.meta ? { ...relation.meta, one_field: null } : null,
								};

								// Base version relation — only if FK table has a version counterpart
								// and version relation doesn't already exist (may have been created by earlier sync)
								const versionRelationCollection = toVersionName(relation.collection);

								const versionRelationExists = refreshedSchema.relations.some(
									(r) => r.collection === versionRelationCollection && r.field === relation.field,
								);

								if (
									!versionRelationExists &&
									hasVersionTable(refreshedSchema, relation.collection) &&
									this.schema.collections[relation.collection]?.fields[relation.field]
								) {
									const versionedCollections = Object.entries(this.schema.collections)
										.filter(([, c]) => c.versioning)
										.map(([name]) => name);

									await relationsService.createOne(
										toVersionRelation(fkRelation, { reference: false, versionedCollections }),
										{ autoPurgeSystemCache: false, emitEvents: false },
									);

									// Reference relation if target is versioned
									if (relation.related_collection && this.schema.collections[relation.related_collection]?.versioning) {
										const sourceField = await fieldsService.readOne(relation.collection, relation.field);
										const versionFieldsService = new FieldsService({ knex: trx, schema: refreshedSchema });

										await versionFieldsService.createField(
											toVersionName(relation.collection),
											toVersionField(sourceField as any, { reference: true }),
											undefined,
											{ autoPurgeSystemCache: false, emitEvents: false },
										);

										const versionRelationService = new RelationsService({
											knex: trx,
											// refresh schema with newly added table/fields
											schema: await getSchema({ bypassCache: true, database: trx }),
										});

										await versionRelationService.createOne(toVersionRelation(relation, { reference: true }), {
											autoPurgeSystemCache: false,
											emitEvents: false,
										});
									}
								}

								// Alias field on V(one_collection)
								if (
									relation.meta?.one_field &&
									relation.meta?.one_collection &&
									hasVersionTable(refreshedSchema, relation.meta.one_collection) &&
									this.schema.collections[relation.meta.one_collection]?.fields[relation.meta.one_field]
								) {
									const versionFieldsService = new FieldsService({ knex: trx, schema: refreshedSchema });
									const aliasField = await fieldsService.readOne(relation.meta.one_collection, relation.meta.one_field);

									await versionFieldsService.createField(
										toVersionName(relation.meta.one_collection),
										toVersionField(aliasField as any, { reference: true }),
										undefined,
										{ autoPurgeSystemCache: false, emitEvents: false },
									);
								}
							}
						}
					} else if (!isVersioned && wasVersioned) {
						const versionCollection = toVersionName(collectionKey);

						if (this.schema.collections[versionCollection]) {
							const collectionsService = new CollectionsService({ knex: trx, schema: this.schema });
							await collectionsService.deleteOne(versionCollection);
						}
					}
				}
			});

			return collectionKey;
		} finally {
			if (shouldClearCache(this.cache, opts)) {
				await this.cache.clear();
			}

			if (opts?.autoPurgeSystemCache !== false) {
				await clearSystemCache({ autoPurgeCache: opts?.autoPurgeCache });
			}

			if (opts?.emitEvents !== false && nestedActionEvents.length > 0) {
				const updatedSchema = await getSchema({ database: this.knex });

				for (const nestedActionEvent of nestedActionEvents) {
					nestedActionEvent.context.schema = updatedSchema;
					emitter.emitAction(nestedActionEvent.event, nestedActionEvent.meta, nestedActionEvent.context);
				}
			}
		}
	}

	/**
	 * Update multiple collections in a single transaction
	 */
	async updateBatch(data: Partial<Collection>[], opts?: MutationOptions): Promise<string[]> {
		if (this.accountability && this.accountability.admin !== true) {
			throw new ForbiddenError();
		}

		if (!Array.isArray(data)) {
			throw new InvalidPayloadError({ reason: 'Input should be an array of collection changes' });
		}

		const collectionKey = 'collection';
		const collectionKeys: string[] = [];
		const nestedActionEvents: ActionEventParams[] = [];

		try {
			await transaction(this.knex, async (trx) => {
				const collectionItemsService = new CollectionsService({
					knex: trx,
					accountability: this.accountability,
					schema: this.schema,
				});

				for (const payload of data) {
					if (!payload[collectionKey]) {
						throw new InvalidPayloadError({ reason: `Collection in update misses collection key` });
					}

					await collectionItemsService.updateOne(payload[collectionKey], omit(payload, collectionKey), {
						autoPurgeCache: false,
						autoPurgeSystemCache: false,
						bypassEmitAction: (params) =>
							opts?.bypassEmitAction ? opts.bypassEmitAction(params) : nestedActionEvents.push(params),
					});

					collectionKeys.push(payload[collectionKey]);
				}
			});
		} finally {
			if (shouldClearCache(this.cache, opts)) {
				await this.cache.clear();
			}

			if (opts?.autoPurgeSystemCache !== false) {
				await clearSystemCache({ autoPurgeCache: opts?.autoPurgeCache });
			}

			if (opts?.emitEvents !== false && nestedActionEvents.length > 0) {
				const updatedSchema = await getSchema({ database: this.knex });

				for (const nestedActionEvent of nestedActionEvents) {
					nestedActionEvent.context.schema = updatedSchema;
					emitter.emitAction(nestedActionEvent.event, nestedActionEvent.meta, nestedActionEvent.context);
				}
			}
		}

		return collectionKeys;
	}

	/**
	 * Update multiple collections by name
	 */
	async updateMany(collectionKeys: string[], data: Partial<Collection>, opts?: MutationOptions): Promise<string[]> {
		if (this.accountability && this.accountability.admin !== true) {
			throw new ForbiddenError();
		}

		const nestedActionEvents: ActionEventParams[] = [];

		try {
			await transaction(this.knex, async (trx) => {
				const service = new CollectionsService({
					schema: this.schema,
					accountability: this.accountability,
					knex: trx,
				});

				for (const collectionKey of collectionKeys) {
					await service.updateOne(collectionKey, data, {
						autoPurgeCache: false,
						autoPurgeSystemCache: false,
						bypassEmitAction: (params) => nestedActionEvents.push(params),
					});
				}
			});

			return collectionKeys;
		} finally {
			if (shouldClearCache(this.cache, opts)) {
				await this.cache.clear();
			}

			if (opts?.autoPurgeSystemCache !== false) {
				await clearSystemCache({ autoPurgeCache: opts?.autoPurgeCache });
			}

			if (opts?.emitEvents !== false && nestedActionEvents.length > 0) {
				const updatedSchema = await getSchema({ database: this.knex });

				for (const nestedActionEvent of nestedActionEvents) {
					nestedActionEvent.context.schema = updatedSchema;
					emitter.emitAction(nestedActionEvent.event, nestedActionEvent.meta, nestedActionEvent.context);
				}
			}
		}
	}

	/**
	 * Delete a single collection This will delete the table and all records within. It'll also
	 * delete any fields, presets, activity, revisions, and permissions relating to this collection
	 */
	async deleteOne(collectionKey: string, opts?: MutationOptions): Promise<string> {
		if (this.accountability && this.accountability.admin !== true) {
			throw new ForbiddenError();
		}

		const nestedActionEvents: ActionEventParams[] = [];

		try {
			const collections = await this.readByQuery();

			const collectionToBeDeleted = collections.find((collection) => collection.collection === collectionKey);

			if (!!collectionToBeDeleted === false) {
				throw new ForbiddenError();
			}

			await transaction(this.knex, async (trx) => {
				if (collectionToBeDeleted!.schema) {
					await trx.schema.dropTable(collectionKey);
				}

				// Make sure this collection isn't used as a group in any other collections
				await trx('directus_collections').update({ group: null }).where({ group: collectionKey });

				if (collectionToBeDeleted!.meta) {
					const collectionsItemsService = new ItemsService('directus_collections', {
						knex: trx,
						accountability: this.accountability,
						schema: this.schema,
					});

					await collectionsItemsService.deleteOne(collectionKey, {
						bypassEmitAction: (params) =>
							opts?.bypassEmitAction ? opts.bypassEmitAction(params) : nestedActionEvents.push(params),
					});
				}

				if (collectionToBeDeleted!.schema) {
					const fieldsService = new FieldsService({
						knex: trx,
						accountability: this.accountability,
						schema: this.schema,
					});

					const fieldItemsService = new ItemsService('directus_fields', {
						knex: trx,
						accountability: this.accountability,
						schema: this.schema,
					});

					await fieldItemsService.deleteByQuery(
						{
							filter: {
								collection: { _eq: collectionKey },
							},
						},
						{
							bypassEmitAction: (params) =>
								opts?.bypassEmitAction ? opts.bypassEmitAction(params) : nestedActionEvents.push(params),
						},
					);

					await trx('directus_presets').delete().where('collection', '=', collectionKey);

					const revisionsToDelete = await trx
						.select('id')
						.from('directus_revisions')
						.where({ collection: collectionKey });

					if (revisionsToDelete.length > 0) {
						const chunks = chunk(
							revisionsToDelete.map((record) => record.id),
							10000,
						);

						for (const keys of chunks) {
							await trx('directus_revisions').update({ parent: null }).whereIn('parent', keys);
						}
					}

					await trx('directus_revisions').delete().where('collection', '=', collectionKey);

					await trx('directus_activity').delete().where('collection', '=', collectionKey);
					await trx('directus_permissions').delete().where('collection', '=', collectionKey);
					await trx('directus_relations').delete().where({ many_collection: collectionKey });

					const { collectionRelationTree, fieldToCollectionList } = await buildCollectionAndFieldRelations(
						this.schema.relations,
					);

					const collectionRelationList = getCollectionRelationList(collectionKey, collectionRelationTree);

					// only process duplication fields if related collections have them
					if (collectionRelationList.size !== 0) {
						const collectionMetas = await trx
							.select('collection', 'archive_field', 'sort_field', 'item_duplication_fields')
							.from('directus_collections')
							.whereIn('collection', Array.from(collectionRelationList))
							.whereNotNull('item_duplication_fields');

						await Promise.all(
							Object.keys(this.schema.collections[collectionKey]?.fields ?? {}).map(async (fieldKey) => {
								const collectionMetaUpdates = getCollectionMetaUpdates(
									collectionKey,
									fieldKey,
									collectionMetas,
									this.schema.collections,
									fieldToCollectionList,
								);

								for (const meta of collectionMetaUpdates) {
									await trx('directus_collections').update(meta.updates).where({ collection: meta.collection });
								}
							}),
						);
					}

					const relations = this.schema.relations.filter((relation) => {
						return relation.collection === collectionKey || relation.related_collection === collectionKey;
					});

					for (const relation of relations) {
						// Delete related o2m fields that point to current collection
						if (relation.related_collection && relation.meta?.one_field) {
							await fieldsService.deleteField(relation.related_collection, relation.meta.one_field, {
								autoPurgeCache: false,
								autoPurgeSystemCache: false,
								bypassEmitAction: (params) =>
									opts?.bypassEmitAction ? opts.bypassEmitAction(params) : nestedActionEvents.push(params),
							});
						}

						// Delete related m2o fields that point to current collection
						if (relation.related_collection === collectionKey) {
							await fieldsService.deleteField(relation.collection, relation.field, {
								autoPurgeCache: false,
								autoPurgeSystemCache: false,
								bypassEmitAction: (params) =>
									opts?.bypassEmitAction ? opts.bypassEmitAction(params) : nestedActionEvents.push(params),
							});
						}
					}

					const a2oRelationsThatIncludeThisCollection = this.schema.relations.filter((relation) => {
						return relation.meta?.one_allowed_collections?.includes(collectionKey);
					});

					for (const relation of a2oRelationsThatIncludeThisCollection) {
						const newAllowedCollections = relation
							.meta!.one_allowed_collections!.filter((collection) => collectionKey !== collection)
							.join(',');

						await trx('directus_relations')
							.update({ one_allowed_collections: newAllowedCollections })
							.where({ id: relation.meta!.id });
					}
				}

				/**
				 * Versioning sync — delete version table if it exists.
				 * Inside the same transaction so both deletions are atomic.
				 *
				 * Note: deleteOne on the version table won't recurse because
				 * the version table has versioning=false and no version counterpart.
				 */
				const versionTableName = toVersionName(collectionKey);

				if (this.schema.collections[versionTableName]) {
					const collectionsService = new CollectionsService({ knex: trx, schema: this.schema });

					await collectionsService.deleteOne(versionTableName, {
						autoPurgeCache: false,
						autoPurgeSystemCache: false,
						bypassEmitAction: (params) =>
							opts?.bypassEmitAction ? opts.bypassEmitAction(params) : nestedActionEvents.push(params),
					});
				}
			});

			return collectionKey;
		} finally {
			if (shouldClearCache(this.cache, opts)) {
				await this.cache.clear();
			}

			if (opts?.autoPurgeSystemCache !== false) {
				await clearSystemCache({ autoPurgeCache: opts?.autoPurgeCache });
			}

			if (opts?.emitEvents !== false && nestedActionEvents.length > 0) {
				const updatedSchema = await getSchema({ database: this.knex });

				for (const nestedActionEvent of nestedActionEvents) {
					nestedActionEvent.context.schema = updatedSchema;
					emitter.emitAction(nestedActionEvent.event, nestedActionEvent.meta, nestedActionEvent.context);
				}
			}
		}
	}

	/**
	 * Delete multiple collections by key
	 */
	async deleteMany(collectionKeys: string[], opts?: MutationOptions): Promise<string[]> {
		if (this.accountability && this.accountability.admin !== true) {
			throw new ForbiddenError();
		}

		const nestedActionEvents: ActionEventParams[] = [];

		try {
			await transaction(this.knex, async (trx) => {
				const service = new CollectionsService({
					schema: this.schema,
					accountability: this.accountability,
					knex: trx,
				});

				for (const collectionKey of collectionKeys) {
					await service.deleteOne(collectionKey, {
						autoPurgeCache: false,
						autoPurgeSystemCache: false,
						bypassEmitAction: (params) => nestedActionEvents.push(params),
					});
				}
			});

			return collectionKeys;
		} finally {
			if (shouldClearCache(this.cache, opts)) {
				await this.cache.clear();
			}

			if (opts?.autoPurgeSystemCache !== false) {
				await clearSystemCache({ autoPurgeCache: opts?.autoPurgeCache });
			}

			if (opts?.emitEvents !== false && nestedActionEvents.length > 0) {
				const updatedSchema = await getSchema({ database: this.knex });

				for (const nestedActionEvent of nestedActionEvents) {
					nestedActionEvent.context.schema = updatedSchema;
					emitter.emitAction(nestedActionEvent.event, nestedActionEvent.meta, nestedActionEvent.context);
				}
			}
		}
	}
}
