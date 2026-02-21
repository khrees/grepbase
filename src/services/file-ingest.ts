/**
 * File content ingestion service
 *
 * Fetches and stores file content for a commit during repository ingestion.
 * Automatically routes files to D1 (small) or R2 (large) storage.
 */

import { fetchFilesAtCommit, fetchFileContent, getLanguageFromPath } from './github';
import { storage, STORAGE_LIMITS } from './storage';
import { files } from '@/db';
import type { Database } from '@/db';
import { logger } from '@/lib/logger';

const fileLogger = logger.child({ service: 'file-ingest' });

/**
 * File extensions to skip (binary/asset files)
 */
const SKIP_EXTENSIONS = new Set([
  // Images
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.bmp', '.tiff',
  // Documents
  '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx',
  // Archives
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  // Media
  '.mp4', '.mov', '.avi', '.wmv', '.flv', '.mp3', '.wav', '.flac',
  // Fonts
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  // Binaries
  '.exe', '.dll', '.so', '.dylib', '.bin', '.dat',
  // Other
  '.lock', '.sum', '.mod',
]);

/**
 * Directory paths to skip
 */
const SKIP_PATHS = new Set([
  'node_modules/',
  'dist/',
  'build/',
  '.next/',
  'coverage/',
  'vendor/',
  'target/',
  '.git/',
  '__pycache__/',
  'venv/',
  '.venv/',
  'env/',
  '.env/',
  'tmp/',
  'temp/',
]);

export interface FileIngestResult {
  totalFiles: number;
  ingestedFiles: number;
  skippedFiles: number;
  failedFiles: number;
  dbStoredFiles: number;
  r2StoredFiles: number;
}

/**
 * Ingest all files for a specific commit
 *
 * @param db - Database instance
 * @param commitId - Commit ID in database
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param sha - Commit SHA
 * @returns Ingestion statistics
 */
export async function ingestFilesForCommit(
  db: Database,
  commitId: number,
  owner: string,
  repo: string,
  sha: string
): Promise<FileIngestResult> {
  const result: FileIngestResult = {
    totalFiles: 0,
    ingestedFiles: 0,
    skippedFiles: 0,
    failedFiles: 0,
    dbStoredFiles: 0,
    r2StoredFiles: 0,
  };

  try {
    // Fetch file tree from GitHub
    const fileList = await fetchFilesAtCommit(owner, repo, sha);
    result.totalFiles = fileList.length;

    fileLogger.info(
      { commitId, sha, totalFiles: result.totalFiles },
      'Starting file ingestion for commit'
    );

    // Filter files to ingest
    const filesToIngest = fileList.filter((file) => {
      // Skip files that are too large
      if (file.size > STORAGE_LIMITS.MAX_R2_SIZE) {
        fileLogger.debug({ path: file.path, size: file.size }, 'Skipping - too large');
        return false;
      }

      // Skip binary/asset files by extension
      const ext = '.' + file.path.split('.').pop()?.toLowerCase();
      if (SKIP_EXTENSIONS.has(ext)) {
        fileLogger.debug({ path: file.path, ext }, 'Skipping - binary/asset');
        return false;
      }

      // Skip common excluded directories
      for (const skipPath of SKIP_PATHS) {
        if (file.path.startsWith(skipPath)) {
          fileLogger.debug({ path: file.path }, 'Skipping - excluded directory');
          return false;
        }
      }

      return true;
    });

    result.skippedFiles = result.totalFiles - filesToIngest.length;

    fileLogger.info(
      { commitId, sha, filesToIngest: filesToIngest.length, skipped: result.skippedFiles },
      'Files filtered for ingestion'
    );

    // Process files in batches to respect D1 limits and GitHub rate limits
    const BATCH_SIZE = 5;

    for (let i = 0; i < filesToIngest.length; i += BATCH_SIZE) {
      const batch = filesToIngest.slice(i, i + BATCH_SIZE);

      // Process batch in parallel
      await Promise.all(
        batch.map(async (file) => {
          try {
            // Fetch file content from GitHub
            const content = await fetchFileContent(owner, repo, sha, file.path);

            if (!content) {
              fileLogger.debug({ path: file.path }, 'No content returned from GitHub');
              result.failedFiles++;
              return;
            }

            const language = getLanguageFromPath(file.path);

            // Store content (automatically chooses D1 or R2 based on size)
            const storageResult = await storage.storeFileContent(
              `files/${owner}/${repo}/${sha}/${file.path}`,
              content,
              { language, size: file.size }
            );

            // Track where it was stored
            if (storageResult.location === 'db') {
              result.dbStoredFiles++;
            } else {
              result.r2StoredFiles++;
            }

            // Insert file record into database
            await db.insert(files).values({
              commitId,
              path: file.path,
              content: storageResult.location === 'db' ? content : null, // null if stored in R2
              size: file.size,
              language,
            });

            result.ingestedFiles++;

            fileLogger.debug(
              { path: file.path, size: file.size, location: storageResult.location },
              'File ingested successfully'
            );
          } catch (error) {
            fileLogger.error({ error, path: file.path }, 'Failed to ingest file');
            result.failedFiles++;
          }
        })
      );

      // Small delay between batches to avoid overwhelming GitHub API
      if (i + BATCH_SIZE < filesToIngest.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    fileLogger.info({ commitId, result }, 'File ingestion complete for commit');
    return result;
  } catch (error) {
    fileLogger.error({ error, commitId, sha }, 'File ingestion failed for commit');
    throw error;
  }
}
