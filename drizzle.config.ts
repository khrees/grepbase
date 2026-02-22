import type { Config } from 'drizzle-kit';
import * as dotenv from 'dotenv';

// Load environment variables from .env or .env.local
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
const token = process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_D1_TOKEN;

if (!accountId || !databaseId || !token) {
    console.warn('Missing Cloudflare D1 credentials in environment variables.');
    console.warn('Migrations and Studio might not work correctly.');
}

export default {
    schema: './src/db/schema.ts',
    out: './drizzle',
    dialect: 'sqlite',
    driver: 'd1-http',
    dbCredentials: {
        accountId: accountId!,
        databaseId: databaseId!,
        token: token!,
    },
} satisfies Config;
