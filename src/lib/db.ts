import { getDb, Database } from '@/db';

export function getDatabase(): Database {
    return getDb();
}
