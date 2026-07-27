'use client';

import { use, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import type { Repository } from '@/types';
import { Loader2 } from 'lucide-react';

export default function ExploreRedirectPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const router = useRouter();

    // Query repo by id using the commits endpoint (which returns repository metadata)
    const { data, error, isLoading } = useQuery<{ repository: Repository }, Error>({
        queryKey: ['repo-redirect', id],
        queryFn: async () => {
            return api.get<{ repository: Repository }>(`/api/repos/${id}/commits?page=1&limit=1`);
        },
        enabled: !!id,
        staleTime: Infinity,
    });

    useEffect(() => {
        if (data?.repository) {
            // Preserve query parameters (e.g., jobId, branch, sha) during redirect
            const params = new URLSearchParams(window.location.search);
            const queryString = params.toString();
            const suffix = queryString ? `?${queryString}` : '';
            router.replace(`/explore/${data.repository.owner}/${data.repository.name}${suffix}`);
        }
    }, [data, router]);

    if (isLoading) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: '1rem', color: '#666' }}>
                <Loader2 size={32} style={{ animation: 'spin 1s linear infinite' }} />
                <p>Redirecting to repository...</p>
                <style>{`
                    @keyframes spin {
                        from { transform: rotate(0deg); }
                        to { transform: rotate(360deg); }
                    }
                `}</style>
            </div>
        );
    }

    if (error) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: '1rem', color: '#ef4444' }}>
                <p>Repository not found.</p>
                <button 
                    onClick={() => router.push('/')}
                    style={{ padding: '0.5rem 1rem', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '0.25rem', cursor: 'pointer' }}
                >
                    Go Home
                </button>
            </div>
        );
    }

    return null;
}
