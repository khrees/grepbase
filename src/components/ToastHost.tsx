'use client';

import { useEffect, useRef } from 'react';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import styles from './ToastHost.module.css';
import { useToastStore } from '@/stores/toast-store';

// Re-export for backward compat during migration
export type ToastKind = 'success' | 'error' | 'info';
export interface ToastEventDetail {
    message: string;
    kind?: ToastKind;
    durationMs?: number;
}
export const TOAST_EVENT_NAME = 'grepbase:toast';

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

    // Legacy: keep listening for CustomEvent-based toasts during migration
    useEffect(() => {
        const fireToast = useToastStore.getState().fireToast;

        function handleLegacyToast(event: Event) {
            const detail = (event as CustomEvent<ToastEventDetail>).detail;
            if (!detail || !detail.message) return;
            fireToast(detail.message, detail.kind, detail.durationMs);
        }

        window.addEventListener(TOAST_EVENT_NAME, handleLegacyToast as EventListener);
        return () => {
            window.removeEventListener(TOAST_EVENT_NAME, handleLegacyToast as EventListener);
        };
    }, []);

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
