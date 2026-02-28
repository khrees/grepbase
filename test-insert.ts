import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
import { getDb, commits, repositories } from './src/db';

async function main() {
    const db = getDb();

    // Insert a test repo
    const repoRes = await db.insert(repositories).values({
        url: "test",
        name: "test",
        owner: "test",
        lastFetched: new Date(),
        createdAt: new Date(),
    }).onConflictDoUpdate({
        target: [repositories.url],
        set: { name: "test" }
    }).returning();

    const repoId = repoRes[0].id;
    console.log("Repo ID:", repoId);

    // Insert a test commit
    await db.insert(commits).values({
        repoId,
        sha: "TEST_SHA_123",
        message: "Test message here\n\nBody",
        date: new Date(),
        order: 1,
        inDefaultLineage: true,
    });

    console.log("Querying commits...");
    const res = await db.select().from(commits).limit(2);
    console.log("DB RESULT:", JSON.stringify(res, null, 2));
}

main().catch(console.error).finally(() => process.exit(0));
