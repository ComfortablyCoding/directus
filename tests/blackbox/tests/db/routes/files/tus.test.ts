import { getUrl } from '@common/config';
import { CreatePermission, DeletePermission } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const file = {
	name: 'tus.text',
	type: 'image/png',
	content: 'tus',
};

const policies = new Map();

beforeAll(async () => {
	for (const vendor of vendors) {
		const response = await CreatePermission(vendor, {
			role: USER.APP_ACCESS.KEY,
			permissions: [
				{
					collection: 'directus_files',
					action: 'create',
					permissions: {},
					fields: ['*'],
				},
				{
					collection: 'directus_files',
					action: 'read',
					permissions: {},
					fields: ['*'],
				},
				{
					collection: 'directus_files',
					action: 'update',
					permissions: {},
					fields: ['*'],
				},
				{
					collection: 'directus_files',
					action: 'delete',
					permissions: {},
					fields: ['*'],
				},
			],
			policyName: 'TUS',
		});

		policies.set(vendor, response.id);
	}
});

afterAll(async () => {
	for (const vendor of vendors) {
		if (!policies.has(vendor)) continue;

		await DeletePermission(vendor, {
			policyId: policies.get(vendor),
		});
	}
});

describe('/files/tus', () => {
	describe('POST /files/tus', () => {
		it.each(vendors)('%s', async (vendor) => {
			// Action
			const response = await request(getUrl(vendor))
				.post('/files/tus')
				.set('Authorization', `Bearer ${USER.APP_ACCESS.TOKEN}`)
				.set('tus-resumable', '1.0.0')
				.set('upload-length', Buffer.from(file.content).byteLength.toString())
				.field('storage', 'local')
				.field('title', file.name)
				.attach('file', Buffer.from(file.content));

			console.log(response);

			// Assert
			expect(response.statusCode).toBe(200);
		});
	});

	describe('PATCH /files/tus/:id', () => {
		it.each(vendors)('%s', async (vendor) => {
			const fileResponse = await request(getUrl(vendor))
				.get('/files')
				.query({
					filter: { title: { _eq: file.name } },
					fields: ['id'],
					limit: 1,
				})
				.set('Authorization', `Bearer ${USER.APP_ACCESS.TOKEN}`);

			// Action
			const response = await request(getUrl(vendor))
				.patch(`/files/tus/${fileResponse.body.data.id}`)
				.set('Authorization', `Bearer ${USER.APP_ACCESS.TOKEN}`)
				.attach('file', Buffer.from(file.content + 'changed'));

			// Assert
			expect(response.statusCode).toBe(200);
		});
	});

	describe('DELETE /files/tus/:id', () => {
		it.each(vendors)('%s', async (vendor) => {
			const fileResponse = await request(getUrl(vendor))
				.get('/files')
				.query({
					filter: { title: { _eq: file.name } },
					fields: ['id'],
					limit: 1,
				})
				.set('Authorization', `Bearer ${USER.APP_ACCESS.TOKEN}`);

			// Action
			const response = await request(getUrl(vendor))
				.delete(`/files/tus/${fileResponse.body.data.id}`)
				.set('Authorization', `Bearer ${USER.APP_ACCESS.TOKEN}`);

			// Assert
			expect(response.statusCode).toEqual(204);
			expect(response.body.data).toBe(undefined);
		});
	});
});
