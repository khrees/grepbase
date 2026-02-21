

import { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, GitCommit, Loader2 } from 'lucide-react';
import styles from './CalendarTimeline.module.css';

interface Commit {
    id: number;
    sha: string;
    message: string;
    authorName: string | null;
    date: string;
    order: number;
}

interface CalendarTimelineProps {
    commits: Commit[];
    onDayClick: (date: Date, dayCommits: Commit[]) => void;
    selectedDate: Date | null;
    loading?: boolean;
    className?: string; // Add optional className
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

export default function CalendarTimeline({
    commits,
    onDayClick,
    selectedDate,
    loading = false,
    className
}: CalendarTimelineProps) {
    // Group commits by date
    const commitsByDate = useMemo(() => {
        const map = new Map<string, Commit[]>();
        commits.forEach(commit => {
            const date = new Date(commit.date);
            const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
            if (!map.has(key)) {
                map.set(key, []);
            }
            map.get(key)!.push(commit);
        });
        return map;
    }, [commits]);

    // Find the first commit date to start the calendar
    const firstCommitDate = useMemo(() => {
        if (commits.length === 0) return new Date();
        const dates = commits.map(c => new Date(c.date));
        return new Date(Math.min(...dates.map(d => d.getTime())));
    }, [commits]);

    // Get list of months that have commits (for navigation)
    const monthsWithCommits = useMemo(() => {
        const monthSet = new Set<string>();
        commits.forEach(commit => {
            const date = new Date(commit.date);
            monthSet.add(`${date.getFullYear()}-${date.getMonth()}`);
        });
        // Convert to sorted array of {year, month} objects
        return Array.from(monthSet)
            .map(key => {
                const [year, month] = key.split('-').map(Number);
                return { year, month };
            })
            .sort((a, b) => {
                if (a.year !== b.year) return a.year - b.year;
                return a.month - b.month;
            });
    }, [commits]);

    const [currentMonth, setCurrentMonth] = useState(() => {
        return new Date(firstCommitDate.getFullYear(), firstCommitDate.getMonth(), 1);
    });

    // Find current month index in monthsWithCommits
    const currentMonthIndex = useMemo(() => {
        return monthsWithCommits.findIndex(
            m => m.year === currentMonth.getFullYear() && m.month === currentMonth.getMonth()
        );
    }, [currentMonth, monthsWithCommits]);

    // Calendar calculation
    const calendarDays = useMemo(() => {
        const year = currentMonth.getFullYear();
        const month = currentMonth.getMonth();

        // First day of the month
        const firstDay = new Date(year, month, 1);
        const firstDayOfWeek = firstDay.getDay();

        // Last day of the month
        const lastDay = new Date(year, month + 1, 0);
        const daysInMonth = lastDay.getDate();

        // Previous month days to show
        const prevMonthLastDay = new Date(year, month, 0).getDate();

        const days: { date: Date; isCurrentMonth: boolean; commits: Commit[] }[] = [];

        // Add previous month days
        for (let i = firstDayOfWeek - 1; i >= 0; i--) {
            const date = new Date(year, month - 1, prevMonthLastDay - i);
            const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
            days.push({
                date,
                isCurrentMonth: false,
                commits: commitsByDate.get(key) || [],
            });
        }

        // Add current month days
        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(year, month, day);
            const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
            days.push({
                date,
                isCurrentMonth: true,
                commits: commitsByDate.get(key) || [],
            });
        }

        // Add next month days to fill the grid
        const remainingDays = 42 - days.length; // 6 weeks * 7 days
        for (let day = 1; day <= remainingDays; day++) {
            const date = new Date(year, month + 1, day);
            const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
            days.push({
                date,
                isCurrentMonth: false,
                commits: commitsByDate.get(key) || [],
            });
        }

        return days;
    }, [currentMonth, commitsByDate]);

    // Navigate to previous month with commits
    function goToPrevMonth() {
        if (currentMonthIndex > 0) {
            const prev = monthsWithCommits[currentMonthIndex - 1];
            setCurrentMonth(new Date(prev.year, prev.month, 1));
        }
    }

    // Navigate to next month with commits
    function goToNextMonth() {
        if (currentMonthIndex < monthsWithCommits.length - 1) {
            const next = monthsWithCommits[currentMonthIndex + 1];
            setCurrentMonth(new Date(next.year, next.month, 1));
        }
    }

    function goToFirstCommit() {
        if (monthsWithCommits.length > 0) {
            const first = monthsWithCommits[0];
            setCurrentMonth(new Date(first.year, first.month, 1));
        }
    }

    const canGoPrev = currentMonthIndex > 0;
    const canGoNext = currentMonthIndex < monthsWithCommits.length - 1;

    function isSelected(date: Date) {
        if (!selectedDate) return false;
        return (
            date.getFullYear() === selectedDate.getFullYear() &&
            date.getMonth() === selectedDate.getMonth() &&
            date.getDate() === selectedDate.getDate()
        );
    }

    function isToday(date: Date) {
        const today = new Date();
        return (
            date.getFullYear() === today.getFullYear() &&
            date.getMonth() === today.getMonth() &&
            date.getDate() === today.getDate()
        );
    }

    // Calculate commit intensity for visual heat map (1-4 levels)
    function getCommitIntensity(commitCount: number): number {
        if (commitCount === 0) return 0;
        if (commitCount === 1) return 1;
        if (commitCount <= 3) return 2;
        if (commitCount <= 6) return 3;
        return 4;
    }

    return (
        <div className={`${styles.calendar} ${className || ''}`}>
            {/* Header */}
            <div className={styles.header}>
                <button
                    className={`${styles.navBtn} ${!canGoPrev ? styles.navBtnDisabled : ''}`}
                    onClick={goToPrevMonth}
                    disabled={!canGoPrev}
                    aria-label="Previous month with commits"
                >
                    <ChevronLeft size={18} />
                </button>

                <div className={styles.headerCenter}>
                    <h2 className={styles.monthYear}>
                        {MONTHS[currentMonth.getMonth()]} {currentMonth.getFullYear()}
                    </h2>
                    <button
                        className={styles.firstCommitBtn}
                        onClick={goToFirstCommit}
                    >
                        <GitCommit size={14} />
                        First Commit
                    </button>
                </div>

                <button
                    className={`${styles.navBtn} ${!canGoNext ? styles.navBtnDisabled : ''}`}
                    onClick={goToNextMonth}
                    disabled={!canGoNext}
                    aria-label="Next month with commits"
                >
                    <ChevronRight size={18} />
                </button>
            </div>

            {/* Weekday headers */}
            <div className={styles.weekdays}>
                {WEEKDAYS.map(day => (
                    <div key={day} className={styles.weekday}>
                        {day}
                    </div>
                ))}
            </div>

            {/* Calendar grid */}
            <div className={styles.grid}>
                {calendarDays.map((day, index) => {
                    const hasCommits = day.commits.length > 0;
                    const intensity = getCommitIntensity(day.commits.length);

                    return (
                        <button
                            key={index}
                            className={`
                                ${styles.day}
                                ${!day.isCurrentMonth ? styles.dayOutside : ''}
                                ${hasCommits ? styles.dayHasCommits : ''}
                                ${hasCommits ? styles[`intensity${intensity}`] : ''}
                                ${isSelected(day.date) ? styles.daySelected : ''}
                                ${isToday(day.date) ? styles.dayToday : ''}
                            `}
                            onClick={() => hasCommits && onDayClick(day.date, day.commits)}
                            disabled={!hasCommits || loading}
                            aria-label={`${day.date.toDateString()}${hasCommits ? `, ${day.commits.length} commit(s)` : ''}`}
                        >
                            <span className={styles.dayNumber}>{day.date.getDate()}</span>
                            {hasCommits && (
                                <div className={styles.commitIndicator}>
                                    <GitCommit size={12} />
                                    <span>{day.commits.length}</span>
                                </div>
                            )}
                            {loading && isSelected(day.date) && (
                                <Loader2 size={16} className={styles.dayLoader} />
                            )}
                        </button>
                    );
                })}
            </div>

            {/* Legend */}
            <div className={styles.legend}>
                <span className={styles.legendLabel}>Activity:</span>
                <div className={styles.legendScale}>
                    <div className={`${styles.legendBox} ${styles.intensity0}`} />
                    <div className={`${styles.legendBox} ${styles.intensity1}`} />
                    <div className={`${styles.legendBox} ${styles.intensity2}`} />
                    <div className={`${styles.legendBox} ${styles.intensity3}`} />
                    <div className={`${styles.legendBox} ${styles.intensity4}`} />
                </div>
                <span className={styles.legendLabel}>More</span>
            </div>
        </div>
    );
}
