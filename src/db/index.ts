import { drizzle } from 'drizzle-orm/d1';
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import { getPlatformEnv, setLocalPlatformEnv } from '@/lib/platform/context';
import { localKVCache } from '@/lib/platform/local';
import type { PlatformEnv } from '@/lib/platform/types';
import * as schema from './schema';

// Export schema for use in queries
export * from './schema';

// Properly typed Database: drizzle instance with full schema awareness
export type Database = ReturnType<typeof drizzle<typeof schema>>;

let _db: Database | null = null;
let _localPlatformSet = false;

function getLocalSqliteDb(): Database {
    const sqlite = new Database('./dev.db');
    return drizzleSqlite(sqlite, { schema }) as unknown as Database;
}

function setupLocalPlatform(): void {
    if (_localPlatformSet) return;
    _localPlatformSet = true;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dbGetter = (() => getLocalSqliteDb()) as any;
    
    const localPlatform: PlatformEnv = {
        getDatabase: dbGetter,
        getStorage: () => null,
        getCache: () => localKVCache,
        getAnalytics: () => null,
        getSecret: (key: string) => process.env[key],
        getContext: () => null,
    };

    setLocalPlatformEnv(localPlatform);
}

export function getDb(): Database {
    if (_db) return _db;

    // Use local SQLite for local development
    if (process.env.USE_LOCAL_DB === 'true') {
        setupLocalPlatform();
        _db = getLocalSqliteDb();
        return _db;
    }

    const platform = getPlatformEnv();
    const d1 = platform.getDatabase();
    _db = drizzle(d1, { schema });
    return _db;
}
