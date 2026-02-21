/**
 * HTTP-based database connection for non-Cloudflare environments
 *
 * Uses Cloudflare's D1 REST API to execute SQL queries.
 * This allows deployment to any platform (Render, Vercel, etc.)
 * while still using Cloudflare D1 as the database.
 */

import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';
import type { Database } from './index';

interface D1QueryResult {
  success: boolean;
  results?: unknown[];
  meta?: {
    changes?: number;
    last_row_id?: number;
    duration?: number;
  };
  error?: string;
}

interface D1ApiResponse {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: string[];
  result: D1QueryResult[];
}

/**
 * Create a minimal D1-compatible client for Drizzle that uses HTTP
 */
function createHttpD1Client(
  accountId: string,
  databaseId: string,
  apiToken: string
) {
  const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}`;

  async function executeQuery(sql: string, params: unknown[]): Promise<unknown[] | null> {
    const url = `${baseUrl}/query`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sql,
        params,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`D1 HTTP API error: ${response.status} - ${errorText}`);
    }

    const data: D1ApiResponse = await response.json();

    if (!data.success) {
      const errorMessage = data.errors?.[0]?.message || 'Unknown D1 error';
      throw new Error(`D1 query failed: ${errorMessage}`);
    }

    const firstResult = data.result?.[0];
    if (!firstResult?.success && firstResult?.error) {
      throw new Error(`D1 query failed: ${firstResult.error}`);
    }

    return firstResult?.results || null;
  }

  function createStatement(query: string) {
    let boundParams: unknown[] = [];

    return {
      bind(...params: unknown[]) {
        boundParams = params;
        return this;
      },

      async first(columnName?: string) {
        const results = await executeQuery(query, boundParams);
        if (!results || results.length === 0) return null;
        if (columnName) {
          return (results[0] as Record<string, unknown>)[columnName];
        }
        return results[0];
      },

      async all() {
        const results = await executeQuery(query, boundParams);
        return {
          success: true,
          results: results || [],
          meta: {
            duration: 0,
            last_row_id: null,
            changes: null,
            served_by: 'http-api',
            internal_stats: null,
          },
        };
      },

      async run() {
        const results = await executeQuery(query, boundParams);
        return {
          success: true,
          results: results || [],
          meta: {
            duration: 0,
            last_row_id: null,
            changes: null,
            served_by: 'http-api',
            internal_stats: null,
          },
        };
      },

      async raw() {
        const results = await executeQuery(query, boundParams);
        return (results || []).map((row) => Object.values(row as Record<string, unknown>));
      },
    };
  }

  return {
    prepare(query: string) {
      return createStatement(query);
    },

    async batch(statements: ReturnType<typeof createStatement>[]) {
      const results = [];
      for (const stmt of statements) {
        const result = await stmt.all();
        results.push(result);
      }
      return results;
    },

    async exec(query: string) {
      await executeQuery(query, []);
      return { count: 1, duration: 0 };
    },

    async dump() {
      throw new Error('dump() not supported via HTTP API');
    },

    withSession() {
      return this;
    },
  };
}

/**
 * Create an HTTP-based D1 database client wrapped with Drizzle
 */
export function createHttpDb(
  accountId: string,
  databaseId: string,
  apiToken: string
): Database {
  const httpD1 = createHttpD1Client(accountId, databaseId, apiToken);
  // Cast to any since our implementation matches the interface Drizzle needs
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return drizzle(httpD1 as any, { schema });
}

export type HttpDatabase = ReturnType<typeof createHttpDb>;
