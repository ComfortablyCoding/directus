import { ErrorCode, ForbiddenError, isDirectusError } from '@directus/errors';
import { isSystemCollection } from '@directus/system-data';
import type { PrimaryKey } from '@directus/types';
import express from 'express';
import collectionExists from '../middleware/collection-exists.js';
import { respond } from '../middleware/respond.js';
import { validateBatch } from '../middleware/validate-batch.js';
import { MetaService } from '../services/meta.js';
import { VersionsService } from '../services/versions.js';
import asyncHandler from '../utils/async-handler.js';
import { sanitizeQuery } from '../utils/sanitize-query.js';

const router = express.Router();

router.post(
	'/:collection',
	collectionExists,
	asyncHandler(async (req, res, next) => {
		if (isSystemCollection(req.params['collection']!)) throw new ForbiddenError();

		const service = new VersionsService(req.collection, {
			accountability: req.accountability,
			schema: req.schema,
		});

		const savedKeys: PrimaryKey[] = [];

		if (Array.isArray(req.body)) {
			const keys = await service.createMany(req.body);
			savedKeys.push(...keys);
		} else {
			const primaryKey = await service.createOne(req.body);
			savedKeys.push(primaryKey);
		}

		try {
			if (Array.isArray(req.body)) {
				const records = await service.readMany(savedKeys, req.sanitizedQuery);
				res.locals['payload'] = { data: records };
			} else {
				const record = await service.readOne(savedKeys[0]!, req.sanitizedQuery);
				res.locals['payload'] = { data: record };
			}
		} catch (error: any) {
			if (isDirectusError(error, ErrorCode.Forbidden)) {
				return next();
			}

			throw error;
		}

		return next();
	}),
	respond,
);

const readHandler = asyncHandler(async (req, res, next) => {
	const service = new VersionsService(req.collection, {
		accountability: req.accountability,
		schema: req.schema,
	});

	const metaService = new MetaService({
		accountability: req.accountability,
		schema: req.schema,
	});

	let result;

	if (req.singleton) {
		result = await service.readSingleton(req.sanitizedQuery);
	} else if (req.body.keys) {
		result = await service.readMany(req.body.keys, req.sanitizedQuery);
	} else {
		result = await service.readByQuery(req.sanitizedQuery);
	}

	const meta = await metaService.getMetaForQuery(req.collection, req.sanitizedQuery);

	res.locals['payload'] = { data: result, meta };
	return next();
});

router.get('/:collection', collectionExists, validateBatch('read'), readHandler, respond);
router.search('/:collection', collectionExists, validateBatch('read'), readHandler, respond);

router.get(
	'/:collection/:pk',
	collectionExists,
	asyncHandler(async (req, res, next) => {
		const service = new VersionsService(req.collection, {
			accountability: req.accountability,
			schema: req.schema,
		});

		const record = await service.readOne(req.params['pk']!, req.sanitizedQuery);

		res.locals['payload'] = { data: record || null };
		return next();
	}),
	respond,
);

router.patch(
	'/:collection',
	collectionExists,
	validateBatch('update'),
	asyncHandler(async (req, res, next) => {
		const service = new VersionsService(req.collection, {
			accountability: req.accountability,
			schema: req.schema,
		});

		let keys: PrimaryKey[] = [];

		if (Array.isArray(req.body)) {
			keys = await service.updateBatch(req.body);
		} else if (req.body.keys) {
			keys = await service.updateMany(req.body.keys, req.body.data);
		} else {
			const sanitizedQuery = await sanitizeQuery(req.body.query, req.schema, req.accountability);
			keys = await service.updateByQuery(sanitizedQuery, req.body.data);
		}

		try {
			const result = await service.readMany(keys, req.sanitizedQuery);
			res.locals['payload'] = { data: result || null };
		} catch (error: any) {
			if (isDirectusError(error, ErrorCode.Forbidden)) {
				return next();
			}

			throw error;
		}

		return next();
	}),
	respond,
);

router.patch(
	'/:collection/:pk',
	collectionExists,
	asyncHandler(async (req, res, next) => {
		const service = new VersionsService(req.collection, {
			accountability: req.accountability,
			schema: req.schema,
		});

		const primaryKey = await service.updateOne(req.params['pk']!, req.body);

		try {
			const record = await service.readOne(primaryKey, req.sanitizedQuery);
			res.locals['payload'] = { data: record || null };
		} catch (error: any) {
			if (isDirectusError(error, ErrorCode.Forbidden)) {
				return next();
			}

			throw error;
		}

		return next();
	}),
	respond,
);

router.delete(
	'/:collection',
	collectionExists,
	validateBatch('delete'),
	asyncHandler(async (req, _res, next) => {
		const service = new VersionsService(req.collection, {
			accountability: req.accountability,
			schema: req.schema,
		});

		if (Array.isArray(req.body)) {
			await service.deleteMany(req.body);
		} else if (req.body.keys) {
			await service.deleteMany(req.body.keys);
		} else {
			const sanitizedQuery = await sanitizeQuery(req.body.query, req.schema, req.accountability);
			await service.deleteByQuery(sanitizedQuery);
		}

		return next();
	}),
	respond,
);

router.delete(
	'/:collection/:pk',
	collectionExists,
	asyncHandler(async (req, _res, next) => {
		const service = new VersionsService(req.collection, {
			accountability: req.accountability,
			schema: req.schema,
		});

		await service.deleteOne(req.params['pk']!);

		return next();
	}),
	respond,
);

router.get(
	'/:collection/:pk/compare',
	asyncHandler(async (req, res, next) => {
		const service = new VersionsService(req.collection, {
			accountability: req.accountability,
			schema: req.schema,
		});

		const version = await service.readOne(req.params['pk']!);

		const main = await service.getMainItem(version['collection'], version['id']);

		res.locals['payload'] = { data: { current: version, main } };

		return next();
	}),
	respond,
);

router.post(
	'/:collection/:pk/promote',
	asyncHandler(async (req, res, next) => {
		const service = new VersionsService(req.collection, {
			accountability: req.accountability,
			schema: req.schema,
		});

		const updatedItemKey = await service.promote(req.params['pk']!, { fields: req.body?.['fields'] });

		res.locals['payload'] = { data: updatedItemKey || null };

		return next();
	}),
	respond,
);

export default router;
