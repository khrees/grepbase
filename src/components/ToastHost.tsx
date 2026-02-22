'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import styles from './ToastHost.module.css';

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastEventDetail {
    message: string;
    kind?: ToastKind;
    durationMs?: number;
}

export const TOAST_EVENT_NAME = 'grepbase:toast';

interface ToastState {
    message: string;
    kind: ToastKind;
}

export default function ToastHost() {
    const [toast, setToast] = useState<ToastState | null>(null);
    const hideTimerRef = useRef<number | null>(null);

    useEffect(() => {
        function handleToast(event: Event) {
            const customEvent = event as CustomEvent<ToastEventDetail>;
            const detail = customEvent.detail;
            if (!detail || !detail.message) return;

            if (hideTimerRef.current) {
                window.clearTimeout(hideTimerRef.current);
            }

            const kind = detail.kind || 'info';
            const duration = Math.max(1200, detail.durationMs || 2800);

            setToast({
                message: detail.message,
                kind,
            });

            hideTimerRef.current = window.setTimeout(() => {
                setToast(null);
            }, duration);
        }

        window.addEventListener(TOAST_EVENT_NAME, handleToast as EventListener);

        return () => {
            window.removeEventListener(TOAST_EVENT_NAME, handleToast as EventListener);
            if (hideTimerRef.current) {
                window.clearTimeout(hideTimerRef.current);
            }
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
