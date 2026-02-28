import { useMutation } from '@tanstack/react-query';
import { startRepositoryIngest } from '@/lib/query/fetchers';

interface ResyncParams {
    owner: string;
    repo: string;
}

export function useResyncRepo() {
    return useMutation({
        mutationFn: ({ owner, repo }: ResyncParams) => startRepositoryIngest(`github.com/${owner}/${repo}`),
    });
}
