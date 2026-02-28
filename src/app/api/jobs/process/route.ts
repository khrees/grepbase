import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { RATE_LIMITS } from '@/lib/constants';
import { processPendingIngestJobs } from '@/services/ingest-worker';
import {
  applyPrivateNoStoreHeaders,
  enforceRateLimit,
} from '@/lib/api-security';

const ADMIN_HEADER = 'x-admin-key';

function timingSafeStringEqual(left: string, right: string): boolean {
  const maxLength = Math.max(left.length, right.length);
  let diff = left.length === right.length ? 0 : 1;

  for (let i = 0; i < maxLength; i += 1) {
    const leftCode = i < left.length ? left.charCodeAt(i) : 0;
    const rightCode = i < right.length ? right.charCodeAt(i) : 0;
    diff |= leftCode ^ rightCode;
  }

  return diff === 0;
}

function enforceAdminAccess(request: NextRequest): NextResponse | null {
  const expectedAdminKey = process.env.ADMIN_API_KEY?.trim();
  if (!expectedAdminKey) {
    return applyPrivateNoStoreHeaders(
      NextResponse.json(
        { success: false, error: 'Server admin key is not configured' },
        { status: 503 }
      )
    );
  }

  const providedAdminKey = request.headers.get(ADMIN_HEADER)?.trim() || '';
  if (!providedAdminKey || !timingSafeStringEqual(providedAdminKey, expectedAdminKey)) {
    return applyPrivateNoStoreHeaders(
      NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    );
  }

  return null;
}

interface ProcessJobsPayload {
  maxJobs?: number;
  clientId?: string;
}

export async function POST(request: NextRequest) {
  const requestLogger = logger.child({ endpoint: 'POST /api/jobs/process' });

  try {
    const rateLimitError = await enforceRateLimit(request, {
      keyPrefix: 'api:jobs:process:post',
      limit: RATE_LIMITS.REPO_INGEST,
    });
    if (rateLimitError) {
      return rateLimitError.response;
    }

    const adminError = enforceAdminAccess(request);
    if (adminError) {
      return adminError;
    }

    const payload = (await request.json().catch(() => ({}))) as ProcessJobsPayload;
    const maxJobs = Number.isFinite(payload.maxJobs) ? Number(payload.maxJobs) : 1;
    const clientId = typeof payload.clientId === 'string' && payload.clientId.trim().length > 0
      ? payload.clientId.trim()
      : 'admin';

    const processed = await processPendingIngestJobs({ maxJobs, clientId });

    return applyPrivateNoStoreHeaders(
      NextResponse.json({
        success: true,
        processed,
      })
    );
  } catch (error) {
    requestLogger.error({ error }, 'Failed to process pending ingest jobs');
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to process pending ingest jobs',
      },
      { status: 500 }
    );
  }
}
