import type { Config } from 'drizzle-kit';
import * as dotenv from 'dotenv';

// Load environment variables from .env or .env.local
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

const useLocalDb = process.env.USE_LOCAL_DB === 'true';

const base = {
    schema: './src/db/schema.ts',
    out: './drizzle',
    dialect: 'sqlite' as const,
};

let config: Config;

if (useLocalDb) {
    config = {
        ...base,
        dbCredentials: {
            url: './dev.db',
        },
    };
} else {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
    const token = process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_D1_TOKEN;

    if (!accountId || !databaseId || !token) {
        console.warn('Missing Cloudflare D1 credentials in environment variables.');
        console.warn('Migrations and Studio might not work correctly.');
    }

    config = {
        ...base,
        driver: 'd1-http',
        dbCredentials: {
            accountId: accountId!,
            databaseId: databaseId!,
            token: token!,
        },
    };
}

export default config;
