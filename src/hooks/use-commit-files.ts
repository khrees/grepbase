import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { shouldFetchFileContent } from '@/lib/file-utils';
import type { FileData, DiffFileData } from '@/types';

interface CommitFilesResponse {
  files?: FileData[];
}

interface CommitFilesOptions {
  onlyChangedFiles?: boolean;
}

export function useCommitFiles(
  repoId: string | undefined,
  commitSha: string | undefined,
  options?: CommitFilesOptions
) {
  const onlyChanged = options?.onlyChangedFiles ?? false;

  return useQuery({
    queryKey: ['commit-files', repoId, commitSha, onlyChanged],
    queryFn: async () => {
      async function fetchChangedFiles(): Promise<FileData[]> {
        const diffRes = await api.get<{ files?: DiffFileData[] }>(
          `/api/repos/${repoId}/commits/${commitSha}/diff`
        );
        const changedFiles = diffRes.files || [];

        let snapshotFiles: FileData[] = [];
        try {
          const snapshotRes = await api.get<CommitFilesResponse>(
            `/api/repos/${repoId}/commits/${commitSha}`
          );
          snapshotFiles = snapshotRes.files || [];
        } catch {
          // Ignore snapshot failure, fallback to diff metadata
        }

        const snapshotMap = new Map(snapshotFiles.map(f => [f.path, f]));
        const result: FileData[] = [];
        const seen = new Set<string>();

        for (const diffFile of changedFiles) {
          if (diffFile.status === 'removed') continue;

          const targetPath = diffFile.path || diffFile.previousPath;
          if (!targetPath || seen.has(targetPath)) continue;
          seen.add(targetPath);

          const existing = snapshotMap.get(targetPath);
          if (existing) {
            result.push(existing);
          } else {
            const ext = targetPath.split('.').pop()?.toLowerCase() || '';
            result.push({
              path: targetPath,
              content: null,
              size: 0,
              language: ext,
              hasContent: true,
              shouldFetchContent: shouldFetchFileContent(targetPath, 0),
            });
          }
        }
        return result;
      }

      if (onlyChanged) {
        return fetchChangedFiles();
      }

      try {
        const data = await api.get<CommitFilesResponse>(
          `/api/repos/${repoId}/commits/${commitSha}`
        );
        if (data.files && data.files.length > 0) {
          return data.files;
        }
      } catch {
        // Full tree fetch failed (e.g. rate limit / network error) — fallback to changed files
      }

      return fetchChangedFiles();
    },
    enabled: !!repoId && !!commitSha,
    staleTime: 5 * 60_000,
  });
}
