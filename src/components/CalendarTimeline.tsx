
import { useMemo, useState } from 'react';
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
    className?: string;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

interface CalendarDay {
    key: string;
    date: Date;
    isCurrentMonth: boolean;
    commits: Commit[];
}

interface CalendarMonth {
    year: number;
    month: number;
}

function toDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getCommitIntensity(commitCount: number, maxCommitCount: number): number {
    if (commitCount === 0 || maxCommitCount === 0) return 0;

    const ratio = commitCount / maxCommitCount;
    if (ratio < 0.25) return 1;
    if (ratio < 0.5) return 2;
    if (ratio < 0.8) return 3;
    return 4;
}

export default function CalendarTimeline({
    commits,
    onDayClick,
    selectedDate,
    loading = false,
    className
}: CalendarTimelineProps) {
    const parsedCommits = useMemo(() => {
        return commits
            .map(commit => {
                const parsedDate = new Date(commit.date);
                return { commit, parsedDate };
            })
            .filter(item => !Number.isNaN(item.parsedDate.getTime()));
    }, [commits]);

    const commitsByDate = useMemo(() => {
        const map = new Map<string, Commit[]>();

        parsedCommits.forEach(({ commit, parsedDate }) => {
            const key = toDateKey(parsedDate);
            if (!map.has(key)) {
                map.set(key, []);
            }
            map.get(key)?.push(commit);
        });

        return map;
    }, [parsedCommits]);

    const monthRange = useMemo<CalendarMonth[]>(() => {
        if (parsedCommits.length === 0) {
            const now = new Date();
            return [{
                year: now.getFullYear(),
                month: now.getMonth(),
            }];
        }

        const sortedDates = parsedCommits
            .map(item => item.parsedDate)
            .sort((a, b) => a.getTime() - b.getTime());

        const first = sortedDates[0];
        const last = sortedDates[sortedDates.length - 1];

        const months: CalendarMonth[] = [];
        const cursor = new Date(first.getFullYear(), first.getMonth(), 1);
        const end = new Date(last.getFullYear(), last.getMonth(), 1);

        while (cursor <= end) {
            const year = cursor.getFullYear();
            const month = cursor.getMonth();
            months.push({
                year,
                month,
            });
            cursor.setMonth(cursor.getMonth() + 1);
        }

        return months;
    }, [parsedCommits]);

    const latestMonth = monthRange[monthRange.length - 1];

    const [currentMonth, setCurrentMonth] = useState(() => {
        if (selectedDate) {
            return new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
        }
        return new Date(latestMonth.year, latestMonth.month, 1);
    });

    const resolvedMonth = useMemo(() => {
        const hasCurrentMonth = monthRange.some(
            month => month.year === currentMonth.getFullYear() && month.month === currentMonth.getMonth()
        );

        if (hasCurrentMonth) {
            return currentMonth;
        }

        return new Date(latestMonth.year, latestMonth.month, 1);
    }, [currentMonth, latestMonth.month, latestMonth.year, monthRange]);

    const currentMonthIndex = useMemo(() => {
        return monthRange.findIndex(
            m => m.year === resolvedMonth.getFullYear() && m.month === resolvedMonth.getMonth()
        );
    }, [monthRange, resolvedMonth]);

    const calendarDays = useMemo<CalendarDay[]>(() => {
        const year = resolvedMonth.getFullYear();
        const month = resolvedMonth.getMonth();

        const firstDay = new Date(year, month, 1);
        const firstDayOffset = firstDay.getDay();

        const days: CalendarDay[] = [];
        for (let i = 0; i < 42; i += 1) {
            const date = new Date(year, month, i - firstDayOffset + 1);
            const key = toDateKey(date);
            days.push({
                key,
                date,
                isCurrentMonth: date.getMonth() === month,
                commits: commitsByDate.get(key) ?? [],
            });
        }

        return days;
    }, [commitsByDate, resolvedMonth]);

    const monthStats = useMemo(() => {
        const currentMonthDays = calendarDays.filter(day => day.isCurrentMonth);
        const totalCommits = currentMonthDays.reduce((sum, day) => sum + day.commits.length, 0);
        const activeDays = currentMonthDays.filter(day => day.commits.length > 0).length;
        const maxCommitsOnADay = currentMonthDays.reduce(
            (max, day) => Math.max(max, day.commits.length),
            0
        );

        return {
            totalCommits,
            activeDays,
            maxCommitsOnADay,
        };
    }, [calendarDays]);

    const selectedKey = selectedDate ? toDateKey(selectedDate) : null;
    const todayKey = useMemo(() => toDateKey(new Date()), []);

    function goToPrevMonth() {
        if (currentMonthIndex > 0) {
            const prev = monthRange[currentMonthIndex - 1];
            setCurrentMonth(new Date(prev.year, prev.month, 1));
        }
    }

    function goToNextMonth() {
        if (currentMonthIndex >= 0 && currentMonthIndex < monthRange.length - 1) {
            const next = monthRange[currentMonthIndex + 1];
            setCurrentMonth(new Date(next.year, next.month, 1));
        }
    }

    function goToLatestMonth() {
        setCurrentMonth(new Date(latestMonth.year, latestMonth.month, 1));
    }

    const canGoPrev = currentMonthIndex > 0;
    const canGoNext = currentMonthIndex >= 0 && currentMonthIndex < monthRange.length - 1;
    const isOnLatestMonth =
        resolvedMonth.getFullYear() === latestMonth.year &&
        resolvedMonth.getMonth() === latestMonth.month;

    return (
        <div className={`${styles.calendar} ${className ?? ''}`}>
            <div className={styles.header}>
                <div className={styles.headerCenter}>
                    <h2 className={styles.monthYear}>
                        {MONTHS[resolvedMonth.getMonth()]} {resolvedMonth.getFullYear()}
                    </h2>
                    <p className={styles.monthMeta}>
                        {monthStats.totalCommits} commit{monthStats.totalCommits === 1 ? '' : 's'}
                        {' '}across {monthStats.activeDays} active day{monthStats.activeDays === 1 ? '' : 's'}
                    </p>
                </div>

                <div className={styles.headerActions}>
                    <button
                        type="button"
                        className={styles.latestBtn}
                        onClick={goToLatestMonth}
                        disabled={isOnLatestMonth}
                        aria-label="Jump to latest commit month"
                    >
                        Latest
                    </button>

                    <button
                        type="button"
                        className={styles.navBtn}
                        onClick={goToPrevMonth}
                        disabled={!canGoPrev}
                        aria-label="Previous month"
                    >
                        <ChevronLeft size={17} />
                    </button>
                    <button
                        type="button"
                        className={styles.navBtn}
                        onClick={goToNextMonth}
                        disabled={!canGoNext}
                        aria-label="Next month"
                    >
                        <ChevronRight size={17} />
                    </button>
                </div>
            </div>

            <div className={styles.weekdays}>
                {WEEKDAYS.map(day => (
                    <div key={day} className={styles.weekday} role="presentation">
                        {day}
                    </div>
                ))}
            </div>

            <div className={styles.grid} aria-label="Commit activity calendar">
                {calendarDays.map(day => {
                    const hasCommits = day.commits.length > 0;
                    const intensity = getCommitIntensity(day.commits.length, monthStats.maxCommitsOnADay);
                    const isSelected = selectedKey === day.key;
                    const isToday = todayKey === day.key;
                    const dayLabel = day.date.toLocaleDateString('en-US', {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                    });

                    return (
                        <button
                            key={day.key}
                            type="button"
                            className={`
                                ${styles.day}
                                ${!day.isCurrentMonth ? styles.dayOutside : ''}
                                ${hasCommits ? styles.dayHasCommits : ''}
                                ${hasCommits ? styles[`intensity${intensity}`] : ''}
                                ${isSelected ? styles.daySelected : ''}
                                ${isToday ? styles.dayToday : ''}
                            `}
                            onClick={() => {
                                if (!hasCommits || loading) return;
                                onDayClick(day.date, day.commits);
                            }}
                            disabled={!hasCommits || loading}
                            aria-pressed={isSelected && hasCommits}
                            aria-label={`${dayLabel}${hasCommits ? `, ${day.commits.length} commit${day.commits.length === 1 ? '' : 's'}` : ', no commits'}`}
                            title={`${dayLabel}${hasCommits ? ` • ${day.commits.length} commit${day.commits.length === 1 ? '' : 's'}` : ''}`}
                        >
                            <span className={styles.dayNumber}>{day.date.getDate()}</span>
                            {hasCommits && (
                                <div className={styles.commitIndicator}>
                                    <GitCommit size={11} />
                                    <span>{day.commits.length}</span>
                                </div>
                            )}
                            {loading && isSelected && (
                                <Loader2 size={16} className={styles.dayLoader} />
                            )}
                        </button>
                    );
                })}
            </div>

            <div className={styles.legend}>
                <span className={styles.legendLabel}>Low</span>
                <div className={styles.legendScale}>
                    <div className={`${styles.legendBox} ${styles.intensity0}`} />
                    <div className={`${styles.legendBox} ${styles.intensity1}`} />
                    <div className={`${styles.legendBox} ${styles.intensity2}`} />
                    <div className={`${styles.legendBox} ${styles.intensity3}`} />
                    <div className={`${styles.legendBox} ${styles.intensity4}`} />
                </div>
                <span className={styles.legendLabel}>High</span>
            </div>
        </div>
    );
}
