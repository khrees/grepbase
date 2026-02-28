import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
import { getDb, commits } from './src/db';

async function main() {
  const db = getDb();
  console.log("DB FETCH: Start");
  const res = await db.select().from(commits).limit(2);
  console.log("DB RESULT:", res);
}

main().catch(console.error).finally(() => process.exit(0));
