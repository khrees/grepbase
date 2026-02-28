'use client';

import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { persistQueryClient } from '@tanstack/query-persist-client-core';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { JOB_STATUS_QUERY_ROOT } from '@/lib/query/keys';

const QUERY_CACHE_STORAGE_KEY = 'grepbase-query-cache-v2';
const LEGACY_QUERY_CACHE_STORAGE_KEY = 'grepbase-query-cache-v1';

function createQueryClient() {
    return new QueryClient({
        defaultOptions: {
            queries: {
                retry: 1,
                staleTime: 30_000,
                gcTime: 30 * 60 * 1000,
                refetchOnWindowFocus: false,
            },
        },
    });
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
    const [queryClient] = useState(createQueryClient);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return undefined;
        }

        window.sessionStorage.removeItem(LEGACY_QUERY_CACHE_STORAGE_KEY);

        const persister = createSyncStoragePersister({
            storage: window.sessionStorage,
            key: QUERY_CACHE_STORAGE_KEY,
            throttleTime: 1_000,
        });

        const [unsubscribe] = persistQueryClient({
            queryClient,
            persister,
            maxAge: 30 * 60 * 1_000,
            dehydrateOptions: {
                shouldDehydrateQuery: (query) =>
                    query.state.status === 'success' &&
                    query.queryKey[0] !== JOB_STATUS_QUERY_ROOT,
            },
        });

        return unsubscribe;
    }, [queryClient]);

    return (
        <QueryClientProvider client={queryClient}>
            {children}
        </QueryClientProvider>
    );
}
