import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
import { getDb, repositories } from './src/db';

async function main() {
  const db = getDb();
  const res = await db.select().from(repositories).limit(2);
  console.log("REPOS:", res);
}
main();
