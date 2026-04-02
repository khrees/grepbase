import Link from 'next/link';
import GrepbaseLogo from '@/components/GrepbaseLogo';
import styles from './not-found.module.css';

export default function NotFound() {
    return (
        <main className={styles.main}>
            <div className={styles.content}>
                <GrepbaseLogo size={40} />
                <h1 className={styles.code}>404</h1>
                <p className={styles.message}>This page doesn&apos;t exist.</p>
                <Link href="/" className={`btn btn-primary ${styles.homeBtn}`}>
                    Go Home
                </Link>
            </div>
        </main>
    );
}
