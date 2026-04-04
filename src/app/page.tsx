import ClientHero from './ClientHero';
import ClientSettingsHeader from './ClientSettingsHeader';
import GrepbaseLogo from '@/components/GrepbaseLogo';
import styles from './page.module.css';

export default async function Home() {
    return (
        <main className={styles.main}>
            <header className={styles.header}>
                <div className={styles.logo}>
                    <GrepbaseLogo size={26} />
                    <span>Grepbase</span>
                </div>
                <ClientSettingsHeader />
            </header>

            <ClientHero styles={styles} />
        </main>
    );
}
