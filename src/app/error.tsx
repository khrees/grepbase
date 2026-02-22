'use client';

import { AlertTriangle } from 'lucide-react';
import styles from './state-boundary.module.css';

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
                {error.message || 'Something went wrong while rendering this page.'}
            </p>
            <div className={styles.actions}>
                <button className="btn btn-secondary" onClick={reset}>
                    Try Again
                </button>
            </div>
        </div>
    );
}
