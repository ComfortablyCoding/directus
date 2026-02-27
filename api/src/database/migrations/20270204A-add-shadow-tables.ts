import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
	await knex.schema.alterTable('directus_collections', (table) => {
		table.boolean('system').notNullable().defaultTo(false);
		table.string('versionOf');
		table.string('versionedBy');
	});

	await knex.schema.alterTable('directus_fields', (table) => {
		table.boolean('system').notNullable().defaultTo(false);
		table.string('versionOf');
		table.string('versionedBy');
	});
}

export async function down(knex: Knex): Promise<void> {
	await knex.schema.alterTable('directus_collections', (table) => {
		table.dropColumn('system');
		table.dropColumn('versionOf');
		table.dropColumn('versionedBy');
	});

	await knex.schema.alterTable('directus_fields', (table) => {
		table.dropColumn('system');
		table.dropColumn('versionOf');
		table.dropColumn('versionedBy');
	});
}
