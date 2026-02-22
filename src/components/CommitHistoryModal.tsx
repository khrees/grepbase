
import { useMemo, useState } from 'react';
import { X, Clock, GitCommit } from 'lucide-react';
import styles from './CommitHistoryModal.module.css';
import CalendarTimeline from './CalendarTimeline';
import CommitTimeline from './CommitTimeline';
import type { Commit } from '@/types';

interface CommitHistoryModalProps {
    isOpen: boolean;
    onClose: () => void;
    commits: Commit[];
    currentIndex: number;
    onSelectCommit: (index: number) => void;
}

export default function CommitHistoryModal({
    isOpen,
    onClose,
    commits,
    currentIndex,
    onSelectCommit
}: CommitHistoryModalProps) {
    const [selectedDate, setSelectedDate] = useState<Date | null>(null);

    const filteredCommits = useMemo(() => {
        if (!selectedDate) return commits;

        const targetYear = selectedDate.getFullYear();
        const targetMonth = selectedDate.getMonth();
        const targetDate = selectedDate.getDate();

        return commits.filter(commit => {
            const commitDate = new Date(commit.date);
            return (
                commitDate.getFullYear() === targetYear &&
                commitDate.getMonth() === targetMonth &&
                commitDate.getDate() === targetDate
            );
        });
    }, [commits, selectedDate]);

    const handleDayClick = (date: Date, dayCommits: Commit[]) => {
        if (dayCommits.length === 0) return;
        setSelectedDate(date);
    };

    const clearFilter = () => {
        setSelectedDate(null);
    };

    const handleCommitClick = (commit: Commit) => {
        const index = commits.findIndex(c => c.id === commit.id);
        if (index >= 0) {
            onSelectCommit(index);
            onClose();
        }
    };

    if (!isOpen) return null;

    return (
        <div className={styles.overlay} onClick={onClose}>
            <div className={styles.modal} onClick={e => e.stopPropagation()}>
                <div className={styles.header}>
                    <h2>
                        <Clock size={24} />
                        Project History
                    </h2>
                    <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close history modal">
                        <X size={24} />
                    </button>
                </div>

                <div className={styles.content}>
                    <div className={styles.calendarSection}>
                        <div className={styles.largeCalendarWrapper}>
                            <CalendarTimeline
                                commits={commits}
                                onDayClick={handleDayClick}
                                selectedDate={selectedDate}
                                className={styles.largeCalendar}
                            />
                        </div>
                    </div>

                    <div className={styles.timelineSection}>
                        <div className={`${styles.sectionTitle} ${styles.sectionTitleRow}`}>
                            <span className={styles.sectionLabel}>
                                <GitCommit size={16} />
                                {selectedDate ? selectedDate.toLocaleDateString() : 'All Commits'}
                            </span>
                            {selectedDate && (
                                <button
                                    type="button"
                                    className={styles.clearFilterBtn}
                                    onClick={clearFilter}
                                >
                                    Show All
                                </button>
                            )}
                        </div>

                        <div className={styles.timelineScroll}>
                            {filteredCommits.length > 0 ? (
                                <CommitTimeline
                                    commits={filteredCommits}
                                    currentIndex={currentIndex}
                                    onSelect={(clickedIndex) => {
                                        const commit = filteredCommits[clickedIndex];
                                        handleCommitClick(commit);
                                    }}
                                />
                            ) : (
                                <div className={styles.timelineWarning}>
                                    No commits on this date.
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
