import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { RATE_LIMITS } from '@/lib/constants';
import { enforceRateLimit, applyPrivateNoStoreHeaders } from '@/lib/api-security';
import { enqueueDueRepositoryRefreshJobs } from '@/services/refresh-scheduler';
import { triggerIngestWorker } from '@/services/ingest-worker';

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

interface SchedulePayload {
  scanLimit?: number;
  enqueueLimit?: number;
  maxJobs?: number;
}

export async function POST(request: NextRequest) {
  const requestLogger = logger.child({ endpoint: 'POST /api/jobs/schedule' });

  try {
    const rateLimitError = await enforceRateLimit(request, {
      keyPrefix: 'api:jobs:schedule:post',
      limit: RATE_LIMITS.REPO_INGEST,
    });
    if (rateLimitError) {
      return rateLimitError.response;
    }

    const adminError = enforceAdminAccess(request);
    if (adminError) {
      return adminError;
    }

    const payload = (await request.json().catch(() => ({}))) as SchedulePayload;
    const scanLimit = Number.isFinite(payload.scanLimit) ? Number(payload.scanLimit) : 200;
    const enqueueLimit = Number.isFinite(payload.enqueueLimit) ? Number(payload.enqueueLimit) : 20;

    const scheduleResult = await enqueueDueRepositoryRefreshJobs({
      scanLimit,
      enqueueLimit,
    });

    if (scheduleResult.enqueued > 0) {
      const requestedMaxJobs = Number.isFinite(payload.maxJobs) ? Number(payload.maxJobs) : scheduleResult.enqueued;
      const workerMaxJobs = Math.max(1, Math.min(requestedMaxJobs, scheduleResult.enqueued));
      triggerIngestWorker({
        maxJobs: workerMaxJobs,
        clientId: 'scheduler',
      });
    }

    return applyPrivateNoStoreHeaders(
      NextResponse.json({
        success: true,
        ...scheduleResult,
      })
    );
  } catch (error) {
    requestLogger.error({ error }, 'Failed to schedule repository refresh jobs');
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to schedule repository refresh jobs',
      },
      { status: 500 }
    );
  }
}
