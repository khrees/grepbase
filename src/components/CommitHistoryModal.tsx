

import { useState } from 'react';
import { X, Calendar, Clock, GitCommit } from 'lucide-react';
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
    const [filteredCommits, setFilteredCommits] = useState<Commit[]>(commits);

    // Reset filter when closed
    // Reset filter when closed - handled by unmounting in parent now
    // or we can initialize state based on props if needed, but since it remounts,
    // useState(commits) is enough.

    // Handle day click - filter the list on the right
    const handleDayClick = (date: Date, dayCommits: Commit[]) => {
        setSelectedDate(date);

        // Find indices in original array
        // We actually want to show these commits in the list
        // Since CommitTimeline takes index based on the full array for selection,
        // we might just want to scroll to the first one or filter the view?
        // For simplicity, let's keep showing all commits but scroll to first one of that day

        if (dayCommits.length > 0) {
            const firstCommit = dayCommits[0];
            const index = commits.findIndex(c => c.id === firstCommit.id);
            if (index >= 0) {
                // We'll close and go there? Or just highlight?
                // The UX req said "Clicking a commit closes the modal"
                // But clicking a DAY should probably just filter or highlight?
                // Let's make clicking a day filter the list on the right to show commits from that day
                // Then clicking one of those commits selects it and closes modal.
                setFilteredCommits(dayCommits);
            }
        }
    };

    // Clear filter
    const clearFilter = () => {
        setSelectedDate(null);
        setFilteredCommits(commits);
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
                    <button className={styles.closeBtn} onClick={onClose}>
                        <X size={24} />
                    </button>
                </div>

                <div className={styles.content}>
                    {/* Left: Interactive Calendar */}
                    <div className={styles.calendarSection}>
                        <div className={styles.sectionTitle}>
                            <Calendar size={16} style={{ display: 'inline', marginRight: 8, verticalAlign: 'text-bottom' }} />
                            Timeline Overview
                        </div>
                        <div className={styles.largeCalendarWrapper}>
                            <CalendarTimeline
                                commits={commits}
                                onDayClick={handleDayClick}
                                selectedDate={selectedDate}
                                className={styles.largeCalendar}
                            />
                        </div>
                    </div>

                    {/* Right: Commit List */}
                    <div className={styles.timelineSection}>
                        <div className={styles.sectionTitle} style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>
                                <GitCommit size={16} style={{ display: 'inline', marginRight: 8, verticalAlign: 'text-bottom' }} />
                                {selectedDate ? selectedDate.toLocaleDateString() : 'All Commits'}
                            </span>
                            {selectedDate && (
                                <button
                                    className="btn btn-ghost btn-xs"
                                    onClick={clearFilter}
                                    style={{ fontSize: '0.7rem', height: 'auto', padding: '2px 6px' }}
                                >
                                    Show All
                                </button>
                            )}
                        </div>

                        <div style={{ flex: 1, overflowY: 'auto' }}>
                            {/* We need a slightly custom list here because CommitTimeline expects full array and index */}
                            {/* Let's reuse CommitTimeline but we need to handle the index mapping */}

                            {filteredCommits.length > 0 ? (
                                <CommitTimeline
                                    commits={filteredCommits}
                                    currentIndex={currentIndex}
                                    // Note: highlighting current index might be weird if filtered.
                                    // If the currently selected commit is in the filtered list, it will highlight.
                                    // But onSelect needs the index in the original commits array for the parent.
                                    onSelect={(clickedIndex) => {
                                        // clickedIndex here is index in filteredCommits
                                        // We need finding the real index
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
