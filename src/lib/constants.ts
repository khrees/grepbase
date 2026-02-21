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

// Cache TTLs (in seconds)
export const CACHE_TTL = {
    MINUTE: 60,
    HOUR: 3600,
    DAY: 86400,
    WEEK: 604800,
    COMMIT_EXPLANATION: 604800, // 1 week
    PROJECT_SUMMARY: 86400, // 1 day
    FILE_CONTENT: 3600, // 1 hour
} as const;

// GitHub API
export const GITHUB = {
    API_BASE: 'https://api.github.com',
    MAX_COMMITS_PER_REQUEST: 100,
} as const;
