'use client';

import { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { persistQueryClient } from '@tanstack/query-persist-client-core';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';

function makeQueryClient(): QueryClient {
    return new QueryClient({
        defaultOptions: {
            queries: {
                retry: 1,
                refetchOnWindowFocus: false,
                staleTime: 30_000,        // 30 s default for mutable queries
                gcTime: 30 * 60 * 1_000,  // 30 min gc time
            },
        },
    });
}

interface QueryProviderProps {
    children: React.ReactNode;
}

export default function QueryProvider({ children }: QueryProviderProps) {
    const [queryClient] = useState(() => makeQueryClient());

    useEffect(() => {
        if (typeof window === 'undefined') return;

        const persister = createSyncStoragePersister({
            storage: window.sessionStorage,
        });

        const [unsubscribe] = persistQueryClient({
            queryClient,
            persister,
            dehydrateOptions: {
                shouldDehydrateQuery: (query) => {
                    // Exclude volatile job-status keys from persistence
                    const [first] = query.queryKey as readonly unknown[];
                    return first !== 'jobs';
                },
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
