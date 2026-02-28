import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { logger } from '@/lib/logger';

const gitMirrorLogger = logger.child({ service: 'git-mirror' });
const LOG_BATCH_FORMAT = '%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%ct%x1f%s%x1e';

interface GitCommandOptions {
  input?: string;
  allowExitCodes?: number[];
}

interface GitCommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface GitCommitMetadata {
  sha: string;
  parentShas: string[];
  authorName: string | null;
  authorEmail: string | null;
  authorDate: Date;
  committerDate: Date;
  subject: string;
}

function resolveCacheRoot(): string {
  const configured = process.env.INGEST_GIT_CACHE_DIR?.trim();
  if (configured) {
    return path.resolve(configured);
  }
  return path.join(process.cwd(), '.cache', 'git-mirrors');
}

function getCacheKey(url: string): string {
  return createHash('sha1').update(url).digest('hex');
}

export function getMirrorPath(url: string): string {
  return path.join(resolveCacheRoot(), `${getCacheKey(url)}.git`);
}

async function runGit(args: string[], options: GitCommandOptions = {}): Promise<GitCommandResult> {
  const allowExitCodes = options.allowExitCodes ?? [];

  return await new Promise<GitCommandResult>((resolve, reject) => {
    const child = spawn('git', args, { stdio: 'pipe' });
    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      reject(error);
    });
    child.on('close', (code) => {
      const exitCode = code ?? 0;
      if (exitCode !== 0 && !allowExitCodes.includes(exitCode)) {
        reject(new Error(`git ${args.join(' ')} failed with code ${exitCode}: ${stderr || stdout}`));
        return;
      }

      resolve({
        code: exitCode,
        stdout,
        stderr,
      });
    });

    if (options.input) {
      child.stdin.write(options.input);
    }
    child.stdin.end();
  });
}

export async function ensureBareMirror(url: string): Promise<string> {
  const mirrorPath = getMirrorPath(url);
  const cacheRoot = resolveCacheRoot();
  await fs.mkdir(cacheRoot, { recursive: true });

  const exists = await fs.stat(mirrorPath).then(() => true).catch(() => false);
  if (!exists) {
    gitMirrorLogger.info({ url, mirrorPath }, 'Creating bare git mirror');
    await runGit(['clone', '--bare', '--filter=blob:none', url, mirrorPath]);
    // Fresh clone already contains all refs — skip the redundant fetch.
    gitMirrorLogger.debug({ url, mirrorPath }, 'Fresh clone complete; skipping post-clone fetch');
    return mirrorPath;
  }

  gitMirrorLogger.debug({ url, mirrorPath }, 'Fetching mirror updates');
  await runGit([
    '-C',
    mirrorPath,
    'fetch',
    '--prune',
    '--tags',
    '--filter=blob:none',
    'origin',
    '+refs/heads/*:refs/heads/*',
  ]);

  return mirrorPath;
}

async function resolveBranchRefForName(mirrorPath: string, branch: string): Promise<string | null> {
  const candidates = [
    `refs/remotes/origin/${branch}`,
    `refs/heads/${branch}`,
  ];

  for (const candidate of candidates) {
    const verification = await runGit(
      ['-C', mirrorPath, 'rev-parse', '--verify', candidate],
      { allowExitCodes: [1, 128] }
    );
    if (verification.code === 0) {
      return candidate;
    }
  }

  return null;
}

export async function resolveDefaultBranch(mirrorPath: string, fallbackBranch: string = 'main'): Promise<string> {
  const symbolic = await runGit(
    ['-C', mirrorPath, 'symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'],
    { allowExitCodes: [1] }
  );

  if (symbolic.code === 0) {
    const ref = symbolic.stdout.trim();
    const prefix = 'refs/remotes/origin/';
    if (ref.startsWith(prefix)) {
      return ref.slice(prefix.length);
    }
  }

  const localHead = await runGit(
    ['-C', mirrorPath, 'symbolic-ref', '--quiet', 'HEAD'],
    { allowExitCodes: [1] }
  );

  if (localHead.code === 0) {
    const ref = localHead.stdout.trim();
    const prefix = 'refs/heads/';
    if (ref.startsWith(prefix)) {
      return ref.slice(prefix.length);
    }
  }

  const candidates = [fallbackBranch, 'main', 'master'];
  for (const branch of candidates) {
    const resolvedRef = await resolveBranchRefForName(mirrorPath, branch);
    if (resolvedRef) {
      return branch;
    }
  }

  throw new Error('Could not resolve default branch from mirror refs');
}

export async function resolveBranchRef(mirrorPath: string, branch: string): Promise<string> {
  const resolved = await resolveBranchRefForName(mirrorPath, branch);
  if (!resolved) {
    throw new Error(`Could not resolve branch ref for ${branch}`);
  }
  return resolved;
}

export async function resolveHeadSha(mirrorPath: string, branch: string): Promise<string> {
  const ref = await resolveBranchRef(mirrorPath, branch);
  const result = await runGit(['-C', mirrorPath, 'rev-parse', ref]);
  return result.stdout.trim();
}

export async function isAncestor(mirrorPath: string, ancestorSha: string, descendantRef: string): Promise<boolean> {
  const result = await runGit(
    ['-C', mirrorPath, 'merge-base', '--is-ancestor', ancestorSha, descendantRef],
    { allowExitCodes: [1] }
  );
  return result.code === 0;
}

function splitLines(stdout: string): string[] {
  return stdout
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
}

export async function listInitialFirstParentShas(
  mirrorPath: string,
  branch: string,
  maxCommits: number
): Promise<string[]> {
  const ref = await resolveBranchRef(mirrorPath, branch);

  if (maxCommits > 0) {
    const latestWindow = await runGit([
      '-C',
      mirrorPath,
      'rev-list',
      '--first-parent',
      `--max-count=${maxCommits}`,
      ref,
    ]);

    return splitLines(latestWindow.stdout).reverse();
  }

  const fullHistory = await runGit([
    '-C',
    mirrorPath,
    'rev-list',
    '--reverse',
    '--first-parent',
    ref,
  ]);
  return splitLines(fullHistory.stdout);
}

export async function listDeltaFirstParentShas(
  mirrorPath: string,
  fromSha: string,
  branch: string
): Promise<string[]> {
  const ref = await resolveBranchRef(mirrorPath, branch);
  const delta = await runGit([
    '-C',
    mirrorPath,
    'rev-list',
    '--reverse',
    '--first-parent',
    `${fromSha}..${ref}`,
  ]);
  return splitLines(delta.stdout);
}

function parseBatchRecord(record: string): GitCommitMetadata | null {
  const cleaned = record.trim();
  if (!cleaned) return null;

  const parts = cleaned.split('\x1f');
  if (parts.length < 7) return null;

  const sha = parts[0].trim();
  const parentShas = parts[1].trim().length > 0
    ? parts[1].trim().split(/\s+/).filter(Boolean)
    : [];
  const authorName = parts[2].trim() || null;
  const authorEmail = parts[3].trim() || null;
  const authorEpoch = Number.parseInt(parts[4].trim(), 10);
  const committerEpoch = Number.parseInt(parts[5].trim(), 10);
  const subject = parts.slice(6).join('\x1f').trim();

  const safeAuthorDate = Number.isFinite(authorEpoch) && authorEpoch > 0
    ? new Date(authorEpoch * 1000)
    : new Date();
  const safeCommitterDate = Number.isFinite(committerEpoch) && committerEpoch > 0
    ? new Date(committerEpoch * 1000)
    : safeAuthorDate;

  return {
    sha,
    parentShas,
    authorName,
    authorEmail,
    authorDate: safeAuthorDate,
    committerDate: safeCommitterDate,
    subject,
  };
}

export async function readCommitMetadataBatch(
  mirrorPath: string,
  shas: string[]
): Promise<GitCommitMetadata[]> {
  if (shas.length === 0) return [];

  const result = await runGit(
    ['-C', mirrorPath, 'log', '--stdin', '--no-walk=unsorted', `--format=${LOG_BATCH_FORMAT}`],
    { input: `${shas.join('\n')}\n` }
  );

  const records = result.stdout.split('\x1e');
  const parsedBySha = new Map<string, GitCommitMetadata>();
  for (const record of records) {
    const parsed = parseBatchRecord(record);
    if (parsed && !parsedBySha.has(parsed.sha)) {
      parsedBySha.set(parsed.sha, parsed);
    }
  }

  const commits = shas
    .map((sha) => parsedBySha.get(sha))
    .filter((commit): commit is GitCommitMetadata => commit !== undefined);

  if (commits.length !== shas.length) {
    gitMirrorLogger.warn(
      { expected: shas.length, parsed: commits.length },
      'Parsed commit metadata count does not match requested SHA count'
    );
  }

  return commits;
}
