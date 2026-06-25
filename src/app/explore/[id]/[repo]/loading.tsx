import { Loader2 } from 'lucide-react';
import styles from '@/app/state-boundary.module.css';

export default function Loading() {
    return (
        <div className={styles.container}>
            <Loader2 size={32} className={styles.spinner} />
            <p className={styles.message}>Loading repository workspace...</p>
        </div>
    );
}
