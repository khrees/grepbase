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
    MAX_COMMITS_PER_REPO: 5000,
} as const;

// File extensions recognized as source code (for content fetching/display)
export const CODE_EXTENSIONS = new Set([
    '.js', '.jsx', '.ts', '.tsx', '.py', '.rs', '.go', '.java',
    '.cpp', '.c', '.h', '.hpp', '.rb', '.php', '.swift', '.kt',
    '.md', '.json', '.yaml', '.yml', '.toml', '.css', '.scss',
    '.html', '.xml', '.sql', '.sh', '.bash',
]);

// Maximum file size for content fetching (100KB)
export const MAX_FILE_SIZE = 100_000;

export function getFileExtension(path: string): string {
    const ext = path.split('.').pop();
    return ext ? `.${ext.toLowerCase()}` : '';
}

export function isCodeFilePath(path: string): boolean {
    return CODE_EXTENSIONS.has(getFileExtension(path));
}

export function shouldFetchFileContent(path: string, size: number | null | undefined): boolean {
    return isCodeFilePath(path) && Number(size || 0) <= MAX_FILE_SIZE;
}
