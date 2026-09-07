import {sqliteTable,text,integer} from 'drizzle-orm/sqlite-core';
export const attempts=sqliteTable('auth_attempts',{key:text('key').primaryKey(),count:integer('count').notNull(),expires:integer('expires').notNull()});
export const sessions=sqliteTable('sessions',{hash:text('hash').primaryKey(),expires:integer('expires').notNull()});
export const reports=sqliteTable('reports',{month:text('month').primaryKey(),payload:text('payload').notNull(),captured:integer('captured').notNull()});
export const locks=sqliteTable('refresh_locks',{month:text('month').primaryKey(),expires:integer('expires').notNull(),status:text('status').notNull(),error:text('error')});
export const secrets=sqliteTable('connection_secrets',{key:text('key').primaryKey(),cipher:text('cipher').notNull(),updated:integer('updated').notNull()});
