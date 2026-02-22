import { drizzle } from 'drizzle-orm/d1';
import { getPlatformEnv } from '@/lib/platform/context';
import * as schema from './schema';

// Export schema for use in queries
export * from './schema';

// Properly typed Database: drizzle instance with full schema awareness
export type Database = ReturnType<typeof drizzle<typeof schema>>;

let _db: Database | null = null;

export function getDb(): Database {
    if (_db) return _db;

    const platform = getPlatformEnv();
    const d1 = platform.getDatabase();
    _db = drizzle(d1, { schema });
    return _db;
}
