import { getDb, repositories } from '@/db';
import { desc } from 'drizzle-orm';
import { BookOpen, Github, Star } from 'lucide-react';
import Link from 'next/link';
import ClientHero from './ClientHero';
import ClientSettingsHeader from './ClientSettingsHeader';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

export default async function Home() {
    const db = getDb();

    // Server-side fetch, fully zero-JS for the user!
    const repoList = await (db.select() as any)
        .from(repositories)
        .orderBy(desc(repositories.lastFetched))
        .limit(6);

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

            {repoList.length > 0 && (
                <section className={styles.recentSection}>
                    <h2 className={styles.sectionTitle}>Recent Explorations</h2>
                    <div className={styles.repoGrid}>
                        {repoList.map((repo: any) => (
                            <Link
                                key={repo.id}
                                href={`/explore/${repo.id}`}
                                className={styles.repoCard}
                            >
                                <div className={styles.repoHeader}>
                                    <Github size={18} />
                                    <span className={styles.repoName}>
                                        {repo.owner}/{repo.name}
                                    </span>
                                </div>
                                {repo.description && (
                                    <p className={styles.repoDesc}>{repo.description}</p>
                                )}
                                <div className={styles.repoMeta}>
                                    <span className={styles.stars}>
                                        <Star size={14} />
                                        {repo.stars.toLocaleString()}
                                    </span>
                                </div>
                            </Link>
                        ))}
                    </div>
                </section>
            )}
        </main>
    );
}
