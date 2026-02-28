import { processRepoIngestion } from './src/services/ingest';
import { getDb } from './src/db';
import crypto from 'node:crypto';

async function main() {
  await processRepoIngestion({
    jobId: crypto.randomUUID(),
    url: "https://github.com/kubernetes/kubernetes",
    clientId: "test",
    db: getDb(),
  });
  console.log("Done!");
}

main().catch(console.error).finally(() => process.exit(0));
