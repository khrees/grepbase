

import { useEffect, useRef } from 'react';
import { GitCommit } from 'lucide-react';
import styles from './CommitTimeline.module.css';

interface Commit {
    id: number;
    sha: string;
    message: string;
    authorName: string | null;
    date: string;
    order: number;
}

interface CommitTimelineProps {
    commits: Commit[];
    currentIndex: number;
    onSelect: (index: number) => void;
}

export default function CommitTimeline({ commits, currentIndex, onSelect }: CommitTimelineProps) {
    const timelineRef = useRef<HTMLDivElement>(null);
    const activeItemRef = useRef<HTMLButtonElement>(null);

    // Scroll to active commit when it changes
    useEffect(() => {
        if (activeItemRef.current && timelineRef.current) {
            activeItemRef.current.scrollIntoView({
                behavior: 'smooth',
                block: 'nearest',
            });
        }
    }, [currentIndex]);

    if (commits.length === 0) {
        return (
            <div className={styles.emptyState}>
                <GitCommit size={32} />
                <p>No commits found</p>
            </div>
        );
    }

    return (
        <div className={styles.timeline} ref={timelineRef}>
            {commits.map((commit, index) => (
                <button
                    key={commit.id}
                    ref={index === currentIndex ? activeItemRef : null}
                    className={`${styles.timelineItem} ${index === currentIndex ? styles.timelineItemActive : ''}`}
                    onClick={() => onSelect(index)}
                >
                    <div className={styles.timelineMarker}>
                        <div className={styles.timelineDot} />
                        {index < commits.length - 1 && <div className={styles.timelineLine} />}
                    </div>
                    <div className={styles.timelineContent}>
                        <span className={styles.timelineOrder}>#{index + 1}</span>
                        <span className={styles.timelineMessage}>
                            {commit.message.split('\n')[0].substring(0, 50)}
                            {commit.message.length > 50 ? '...' : ''}
                        </span>
                    </div>
                </button>
            ))}
        </div>
    );
}
