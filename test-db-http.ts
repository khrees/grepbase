import { getDb, commits } from './src/db';
async function main() {
  const db = getDb();
  const res = await db.select().from(commits).limit(2);
  console.log("IS ARRAY OF ARRAYS?");
  console.log(res);
}
main();
