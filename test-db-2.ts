import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';

const commits = sqliteTable('commits', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sha: text('sha').notNull(),
    message: text('message').notNull(),
});

function main() {
  const sqlite = new Database('.wrangler/state/v3/d1/miniflare-D1DatabaseObject/0000000000000000000000000000000000000000000000000000000000000000.sqlite');
  const db = drizzle(sqlite);
  const result = db.select().from(commits).limit(2).all();
  console.log(JSON.stringify(result, null, 2));
}

main();
