import { drizzle } from 'drizzle-orm/d1';
import { getPlatformEnv } from '@/lib/platform/context';
import * as schema from './schema';

// Export schema for use in queries
export * from './schema';

// Export the Database type explicitly defined instead of inferred implicitly from getDb
export type Database = ReturnType<typeof drizzle>;

// Type for Cloudflare environment with D1 binding
export interface CloudflareEnv {
    DB: D1Database;
    GITHUB_TOKEN?: string;
}

let _db: Database | null = null;

// Global database utility getter
export function getDb(): Database {
    if (_db) return _db;

    const platform = getPlatformEnv();

    // In our Next.js App we will always fall back to HTTP Platform Env
    // So the "D1Database" we get is actually the httpDb mock
    const rawDb = platform.getDatabase();

    // We already wrapped it in drizzle inside getHttpPlatformEnv/createHttpDb
    // but the getDatabase signature returns D1Database.
    // In Next.js with HTTP Driver, rawDb IS the drizzle instance already.
    _db = rawDb as unknown as Database;
    return _db;
}
