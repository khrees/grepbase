

import { useEffect, useRef } from 'react';
import { GitCommit, Pin, Loader2 } from 'lucide-react';
import styles from './CommitTimeline.module.css';
import type { Commit } from '@/types';

interface CommitTimelineProps {
    commits: Commit[];
    currentIndex: number;
    onSelect: (index: number) => void;
    pinnedBaseSha?: string | null;
    onPinAsBase?: (sha: string) => void;
    onLoadOlder?: () => void;
    onLoadNewer?: () => void;
    hasMoreOlder?: boolean;
    hasMoreNewer?: boolean;
    loadingCommits?: boolean;
}

export default function CommitTimeline({ 
    commits, 
    currentIndex, 
    onSelect,
    pinnedBaseSha,
    onPinAsBase,
    onLoadOlder,
    onLoadNewer,
    hasMoreOlder,
    hasMoreNewer,
    loadingCommits
}: CommitTimelineProps) {
    const timelineRef = useRef<HTMLDivElement>(null);
    const activeItemRef = useRef<HTMLDivElement>(null);

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
                <div
                    key={commit.id}
                    ref={index === currentIndex ? activeItemRef : null}
                    className={`${styles.timelineItemWrapper} ${index === currentIndex ? styles.timelineItemActive : ''}`}
                >
                    <button
                        className={styles.timelineItem}
                        onClick={() => onSelect(index)}
                    >
                        <div className={styles.timelineMarker}>
                            <div className={styles.timelineDot} />
                            {index < commits.length - 1 && <div className={styles.timelineLine} />}
                            {index === commits.length - 1 && hasMoreOlder && <div className={styles.timelineLine} />}
                        </div>
                        <div className={styles.timelineContent}>
                            <span className={styles.timelineOrder}>#{index + 1}</span>
                            <span className={styles.timelineMessage}>
                                {commit.message.split('\n')[0].substring(0, 50)}
                                {commit.message.length > 50 ? '...' : ''}
                            </span>
                        </div>
                    </button>
                    {onPinAsBase && (
                        <button
                            className={`${styles.pinButton} ${pinnedBaseSha === commit.sha ? styles.pinned : ''}`}
                            onClick={(e) => {
                                e.stopPropagation();
                                onPinAsBase(commit.sha);
                            }}
                            title="Pin as Compare Base"
                            aria-label="Pin as Compare Base"
                        >
                            <Pin size={14} className={pinnedBaseSha === commit.sha ? styles.pinIconActive : ''} />
                        </button>
                    )}
                </div>
            ))}
            {hasMoreOlder && onLoadOlder && (
                <button
                    className={styles.loadMoreButton}
                    onClick={onLoadOlder}
                    disabled={loadingCommits}
                >
                    {loadingCommits ? <Loader2 size={16} className={styles.spinner} /> : 'Load Older Commits'}
                </button>
            )}
        </div>
    );
}
