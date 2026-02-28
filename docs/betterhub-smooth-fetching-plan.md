# Better Hub-Style Smooth Fetching Plan (Adapted for Grepbase)

## Summary
This document captures the Better Hub-style smooth-fetching architecture adapted for Grepbase:

- Move all read flows to a shared TanStack Query cache.
- Keep the UI local-first and background-refreshing.
- Remove old manual polling and effect-driven fetch code after migration.
- Preserve strict HTTP cache policy: `Cache-Control: private, no-store, max-age=0`.

## Scope
Applies to current routes and flows that read repo/job data:

- `/`
- `/explore/[id]`
- `/explore/[id]/timeline`
- setup/settings-related ingestion flows

Out of scope:

- AI streaming endpoints as persisted query data (these remain mutation/stream-driven).
- SSR hydration/prefetch in v1.

## Core Decisions
1. Use TanStack Query as the single client-side data layer.
2. Use session-scoped query persistence via `sessionStorage`.
3. Exclude volatile job-status queries from persistence.
4. Use immutable key policy for SHA-scoped resources (`staleTime: Infinity`).
5. Use finite stale policy for mutable list/status queries.
6. Remove legacy dual systems quickly (aggressive cleanup).

## Primary Touchpoints
- `src/app/layout.tsx`
- `src/lib/api-client.ts`
- `src/app/explore/[id]/page.tsx`
- `src/app/explore/[id]/timeline/page.tsx`
- `src/app/ClientHero.tsx`
- `src/components/SetupFlow.tsx`
- `src/app/api/jobs/[jobId]/route.ts`
- `src/services/github.ts`
- `src/lib/commit-pagination.ts` (cleanup target)

## Implementation Plan
### 1) Query Infrastructure
1. Install:
   - `@tanstack/react-query`
   - `@tanstack/query-persist-client-core`
   - `@tanstack/query-sync-storage-persister`
2. Add app-level `QueryProvider` in root layout.
3. Set default query behavior:
   - `retry: 1`
   - `refetchOnWindowFocus: false`
   - `staleTime: 30s`
   - `gcTime: 30m`
4. Persist query cache in `sessionStorage` (exclude job-status keys).

### 2) Shared Query Layer
1. Create canonical keys in `src/lib/query/keys.ts`.
2. Add typed fetchers in `src/lib/query/fetchers.ts`.
3. Add shared hooks in `src/lib/query/hooks/*`:
   - `useReposList`
   - `useRepoCommitsInfinite`
   - `useCommitFiles`
   - `useFileContent`
   - `useCommitDiff`
   - `useCompareDiff`
   - `useJobStatus`
   - `useStartIngest`
   - `useResyncRepo`
4. Enforce key immutability/staleness strategy:
   - SHA-specific queries: `staleTime: Infinity`
   - list/status queries: finite stale windows

### 3) Ingestion + Job Polling
1. Replace custom polling loops in Home, SetupFlow, and Explore resync with `useJobStatus`.
2. Keep dynamic interval/backoff behavior (fast initial polls then slower).
3. Stop polling when terminal/ready conditions are reached:
   - `completed`
   - `failed`
   - `ready` or `processedCommits > 0` (contextual)
4. Invalidate related repo queries on ingest/resync completion.

### 4) Explore Migration
1. Replace local effect-based read orchestration with shared query hooks.
2. Keep only UI state local:
   - selected commit index
   - selected file
   - panel visibility
   - view mode
3. Prefetch neighbor commit assets on navigation:
   - commit files
   - commit diff
4. Show cached content immediately and lazy-fetch missing file content.

### 5) Timeline Migration
1. Reuse the same infinite commits query as Explore.
2. Remove duplicate timeline prefetch logic.
3. Keep day-summary generation as mutation/stream flow.

### 6) Home + Setup Migration
1. Replace ad-hoc ingest/poll code with shared hooks/mutations.
2. Remove compatibility branches for old job response envelopes.

### 7) Backend Smoothing (Without Relaxing Cache Policy)
1. Keep `applyPrivateNoStoreHeaders` unchanged.
2. Add in-flight deduplication in `src/services/github.ts` so concurrent misses collapse into one upstream fetch.
3. Normalize `/api/jobs/[jobId]` response shape and include `repository` summary when available.

### 8) Aggressive Cleanup
1. Delete `src/lib/commit-pagination.ts`.
2. Remove superseded state/effect fetch code in Explore/Timeline.
3. Remove bespoke polling implementations in `ClientHero` and `SetupFlow`.
4. Remove duplicate local interfaces in favor of shared `src/types`.

## Public Interface Changes
1. Add query module surface:
   - `src/lib/query/keys.ts`
   - `src/lib/query/fetchers.ts`
   - `src/lib/query/hooks/*`
   - provider mounted in app layout
2. Normalize `/api/jobs/[jobId]` response shape.
3. Keep route paths/auth/rate-limits unchanged.
4. Keep protected endpoint headers as `private, no-store`.

## Testing Plan
1. Query key stability tests (same params => same key, changed params => new key).
2. Hook tests for polling stop conditions + interval/backoff behavior.
3. Unit tests for in-flight dedupe utility in `github.ts`.
4. API tests for normalized `/api/jobs/[jobId]` response.
5. API tests ensuring `private, no-store` headers remain applied.
6. Manual flows:
   - ingest on Home then open Explore (consistent ready/progress states)
   - rapid commit switching (instant cached revisit)
   - repeated view switching (no request bursts)
   - refresh Explore in same session (quick cache restore + non-blocking revalidate)
   - transient API errors show stale data when available, then recover

## Bun Commands
```bash
bun add @tanstack/react-query @tanstack/query-persist-client-core @tanstack/query-sync-storage-persister
bun run lint
bun test
```

## Success Criteria
1. Fewer duplicate requests across route/view transitions.
2. Faster repeat navigation and back/forward interactions.
3. No auth/security header regressions.
4. No long-lived duplicate fetch systems remaining in code.
