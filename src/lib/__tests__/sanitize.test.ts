import { describe, test, expect } from 'bun:test';
import {
    sanitizeGitHubUrl,
    parseGitHubUrl,
    sanitizeCommitSha,
    sanitizeBranchName,
    sanitizeFilePath,
} from '../sanitize';

describe('sanitize', () => {
    describe('sanitizeGitHubUrl', () => {
        test('accepts valid GitHub URLs', () => {
            const url = 'https://github.com/owner/repo';
            expect(sanitizeGitHubUrl(url)).toBe(url);
        });

        test('upgrades HTTP to HTTPS', () => {
            const result = sanitizeGitHubUrl('http://github.com/owner/repo');
            expect(result).toBe('https://github.com/owner/repo');
        });

        test('removes query params', () => {
            const result = sanitizeGitHubUrl('https://github.com/owner/repo?tab=readme');
            expect(result).toBe('https://github.com/owner/repo');
        });

        test('removes hash fragments', () => {
            const result = sanitizeGitHubUrl('https://github.com/owner/repo#section');
            expect(result).toBe('https://github.com/owner/repo');
        });

        test('rejects non-GitHub URLs', () => {
            expect(() => sanitizeGitHubUrl('https://gitlab.com/owner/repo')).toThrow();
        });

        test('rejects invalid URLs', () => {
            expect(() => sanitizeGitHubUrl('not-a-url')).toThrow();
        });
    });

    describe('parseGitHubUrl', () => {
        test('parses standard GitHub URL', () => {
            const result = parseGitHubUrl('https://github.com/facebook/react');
            expect(result).toEqual({ owner: 'facebook', repo: 'react' });
        });

        test('removes .git extension', () => {
            const result = parseGitHubUrl('https://github.com/vercel/next.js.git');
            expect(result).toEqual({ owner: 'vercel', repo: 'next.js' });
        });

        test('validates owner name', () => {
            expect(() => parseGitHubUrl('https://github.com/invalid name/repo')).toThrow();
        });

        test('validates repo name', () => {
            expect(() => parseGitHubUrl('https://github.com/owner/invalid@repo')).toThrow();
        });

        test('requires both owner and repo', () => {
            expect(() => parseGitHubUrl('https://github.com/owner')).toThrow();
        });
    });

    describe('sanitizeCommitSha', () => {
        test('accepts full SHA', () => {
            const sha = 'a94a8fe5ccb19ba61c4c0873d391e987982fbbd3';
            expect(sanitizeCommitSha(sha)).toBe(sha);
        });

        test('accepts short SHA', () => {
            const sha = 'a94a8fe';
            expect(sanitizeCommitSha(sha)).toBe(sha);
        });

        test('converts to lowercase', () => {
            const result = sanitizeCommitSha('A94A8FE');
            expect(result).toBe('a94a8fe');
        });

        test('rejects invalid characters', () => {
            expect(() => sanitizeCommitSha('invalid-sha-123')).toThrow();
            expect(() => sanitizeCommitSha('g94a8fe')).toThrow();
        });

        test('rejects too short SHA', () => {
            expect(() => sanitizeCommitSha('abc12')).toThrow();
        });

        test('rejects too long SHA', () => {
            expect(() => sanitizeCommitSha('a'.repeat(41))).toThrow();
        });
    });

    describe('sanitizeBranchName', () => {
        test('accepts valid branch names', () => {
            expect(sanitizeBranchName('main')).toBe('main');
            expect(sanitizeBranchName('feature/new-feature')).toBe('feature/new-feature');
            expect(sanitizeBranchName('release-1.0')).toBe('release-1.0');
        });

        test('rejects invalid characters', () => {
            expect(() => sanitizeBranchName('feature@branch')).toThrow();
            expect(() => sanitizeBranchName('branch name')).toThrow();
        });

        test('rejects double dots', () => {
            expect(() => sanitizeBranchName('feature..branch')).toThrow();
        });

        test('rejects starting with dot', () => {
            expect(() => sanitizeBranchName('.hidden')).toThrow();
        });

        test('rejects ending with dot', () => {
            expect(() => sanitizeBranchName('branch.')).toThrow();
        });
    });

    describe('sanitizeFilePath', () => {
        test('accepts valid file paths', () => {
            expect(sanitizeFilePath('src/index.ts')).toBe('src/index.ts');
            expect(sanitizeFilePath('components/Button.tsx')).toBe('components/Button.tsx');
        });

        test('rejects directory traversal', () => {
            expect(() => sanitizeFilePath('../etc/passwd')).toThrow();
            expect(() => sanitizeFilePath('src/../../../etc/passwd')).toThrow();
        });

        test('rejects absolute paths', () => {
            expect(() => sanitizeFilePath('/etc/passwd')).toThrow();
        });

        test('rejects invalid characters', () => {
            expect(() => sanitizeFilePath('file name.txt')).toThrow();
            expect(() => sanitizeFilePath('file@name.txt')).toThrow();
        });
    });
});
