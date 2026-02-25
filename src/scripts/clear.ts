import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

import { getDb } from '../db';
import { repositories, commits, files, analyses, ingestJobs } from '../db/schema';
import { sql } from 'drizzle-orm';

interface KvListResponse {
    result: Array<{ name: string }>;
    result_info?: {
        cursor?: string;
    };
}

async function clearData() {
    console.log('Clearing database...');
    const db = getDb();

    // Delete data from tables
    await db.delete(analyses);
    console.log('Cleared analyses');
    await db.delete(files);
    console.log('Cleared files');
    await db.delete(commits);
    console.log('Cleared commits');
    await db.delete(ingestJobs);
    console.log('Cleared ingestJobs');
    await db.delete(repositories);
    console.log('Cleared repositories');

    // try to reset auto increment
    try {
        await db.run(sql`DELETE FROM sqlite_sequence`);
        console.log('Reset sqlite_sequence');
    } catch {
        // ignore
    }

    console.log('Database cleared.');

    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const namespaceId = process.env.CLOUDFLARE_KV_NAMESPACE_ID;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_D1_TOKEN;

    if (accountId && namespaceId && apiToken) {
        console.log('Clearing KV cache...');
        let cursor = '';
        let deleted = 0;

        do {
            const listUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/keys${cursor ? `?cursor=${cursor}` : ''}`;
            const listRes = await fetch(listUrl, {
                headers: { 'Authorization': `Bearer ${apiToken}` }
            });

            if (!listRes.ok) {
                console.error('Failed to list KV keys', await listRes.text());
                break;
            }

            const data = await listRes.json() as KvListResponse;
            const keys = data.result.map((k) => k.name);

            if (keys.length > 0) {
                const deleteUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/bulk`;
                const deleteRes = await fetch(deleteUrl, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify(keys)
                });
                if (deleteRes.ok) {
                    deleted += keys.length;
                    console.log(`Deleted ${deleted} keys...`);
                } else {
                    console.error('Failed to delete bulk keys', await deleteRes.text());
                }
            }
            cursor = data.result_info?.cursor || '';
        } while (cursor);

        console.log('KV cleared.');
    } else {
        console.log('Skipping KV clear - missing credentials');
    }
}

clearData().catch(console.error).finally(() => process.exit(0));
