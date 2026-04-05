/**
 * Application constants
 */

// AI Model Configuration
export const AI_CONSTANTS = {
    MAX_OUTPUT_TOKENS: {
        DAY_SUMMARY: 800,
        COMMIT_EXPLANATION: 1500,
        PROJECT_OVERVIEW: 2000,
        QUESTION_ANSWER: 1000,
    },
    TEMPERATURE: {
        DEFAULT: 0.7,
        PRECISE: 0.3,
        CREATIVE: 0.9,
    },
} as const;

// Pagination
export const PAGINATION = {
    DEFAULT_PAGE: 1,
    DEFAULT_LIMIT: 50,
    MAX_LIMIT: 100,
} as const;

// Rate Limiting (requests per minute)
export const RATE_LIMITS = {
    EXPLAIN_API: 20,
    REPO_INGEST: 5,
    GENERAL_API: 60,
} as const;

// Tiered Cache TTLs - different expiration based on data volatility
export const CACHE_TIER = {
    // Volatile - changes frequently (PRs, issues, events, recent commits)
    FAST: 5 * 60, // 5 minutes
    // Semi-stable - changes occasionally (branches, tags, file tree, older commits)
    MEDIUM: 60 * 60, // 1 hour
    // Stable - rarely changes (repo metadata, languages, contributors)
    SLOW: 24 * 60 * 60, // 24 hours
    // Immutable - won't change (file content at specific SHA)
    IMMUTABLE: 7 * 24 * 60 * 60, // 1 week
} as const;

// GitHub API
export const GITHUB = {
    API_BASE: 'https://api.github.com',
    MAX_COMMITS_PER_REQUEST: 100,
    MAX_COMMITS_PER_REPO: 5000,
} as const;

// External API timeouts (in milliseconds)
export const TIMEOUTS = {
    DEFAULT: 30000,
    GITHUB_API: 30000,
    AI_PROVIDER: 60000,
} as const;

// Validation patterns
export const COMMIT_SHA_REGEX = /^[0-9a-f]{7,64}$/i;
export const MAX_FILE_PATH_LENGTH = 1024;

// Ingestion settings
export const INGEST = {
    MASSIVE_REPO_SIZE_KB: 100_000,
    LATEST_COMMITS_TO_PREFETCH_DEFAULT: 1,
    FILE_BATCH_INSERT_SIZE: 500,
    COMMIT_BATCH_SIZE: 50,
    FILE_BATCH_DELAY_MS: 100,
} as const;

// Resource access settings
export const RESOURCE_ACCESS = {
    TTL_SECONDS: 60 * 60 * 24 * 180, // 180 days
    MAX_REPO_IDS_PER_SESSION: 500,
    MAX_SESSIONS_PER_REPO: 500,
} as const;

// Job retry settings
export const JOB_RETRY = {
    STUCK_JOB_THRESHOLD_MS: 15 * 60 * 1000, // 15 minutes
    BATCH_SIZE: 10,
    MAX_RETRIES: 3,
} as const;

