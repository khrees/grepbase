'use client';

import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import styles from '@/app/state-boundary.module.css';

export default function Error({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    return (
        <div className={styles.container}>
            <AlertTriangle size={32} />
            <p className={styles.message}>
                {error.message || 'Explore page crashed while rendering this repository.'}
            </p>
            <div className={styles.actions}>
                <button className="btn btn-secondary" onClick={reset}>
                    Retry
                </button>
                <Link href="/" className="btn btn-ghost">
                    Back Home
                </Link>
            </div>
        </div>
    );
}
