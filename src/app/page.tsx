import { BookOpen } from 'lucide-react';
import ClientHero from './ClientHero';
import ClientSettingsHeader from './ClientSettingsHeader';
import styles from './page.module.css';

export default async function Home() {
    return (
        <main className={styles.main}>
            <header className={styles.header}>
                <div className={styles.logo}>
                    <BookOpen size={28} />
                    <span>Grepbase</span>
                </div>
                <ClientSettingsHeader />
            </header>

            <ClientHero styles={styles} />
        </main>
    );
}
