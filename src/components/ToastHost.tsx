'use client';

import { useEffect, useRef } from 'react';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import styles from './ToastHost.module.css';
import { useToastStore } from '@/stores/toast-store';

export default function ToastHost() {
    const toast = useToastStore(s => s.toast);
    const dismiss = useToastStore(s => s.dismiss);
    const hideTimerRef = useRef<number | null>(null);

    useEffect(() => {
        if (!toast) return;

        if (hideTimerRef.current) {
            window.clearTimeout(hideTimerRef.current);
        }

        hideTimerRef.current = window.setTimeout(() => {
            dismiss();
        }, toast.durationMs);

        return () => {
            if (hideTimerRef.current) {
                window.clearTimeout(hideTimerRef.current);
            }
        };
    }, [toast, dismiss]);

    if (!toast) return null;

    return (
        <div className={`${styles.toast} ${styles[toast.kind]}`} role="status" aria-live="polite">
            <span className={styles.icon}>
                {toast.kind === 'success' ? <CheckCircle2 size={16} /> : null}
                {toast.kind === 'error' ? <AlertCircle size={16} /> : null}
                {toast.kind === 'info' ? <Info size={16} /> : null}
            </span>
            <span className={styles.message}>{toast.message}</span>
        </div>
    );
}
