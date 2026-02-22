import { useMemo } from 'react';
import styles from './DiffViewer.module.css';

interface DiffViewerProps {
    patch: string | null | undefined;
    mode?: 'unified' | 'split';
    emptyMessage?: string;
}

type UnifiedLineType = 'meta' | 'hunk' | 'context' | 'addition' | 'deletion' | 'notice';

interface UnifiedLine {
    type: UnifiedLineType;
    text: string;
}

interface SplitCell {
    type: 'context' | 'addition' | 'deletion' | 'hunk' | 'notice' | 'empty';
    text: string;
}

interface SplitRow {
    left: SplitCell;
    right: SplitCell;
}

function classifyLine(line: string): UnifiedLine {
    if (line.startsWith('@@')) return { type: 'hunk', text: line };
    if (line.startsWith('+++') || line.startsWith('---')) return { type: 'meta', text: line };
    if (line.startsWith('+')) return { type: 'addition', text: line };
    if (line.startsWith('-')) return { type: 'deletion', text: line };
    if (line.startsWith('\\')) return { type: 'notice', text: line };
    return { type: 'context', text: line };
}

function parseUnifiedLines(patch: string): UnifiedLine[] {
    return patch.split('\n').map(classifyLine);
}

function parseSplitRows(patch: string): SplitRow[] {
    const rows: SplitRow[] = [];
    const removedBuffer: string[] = [];
    const addedBuffer: string[] = [];

    function flushBuffers() {
        if (removedBuffer.length === 0 && addedBuffer.length === 0) return;

        const count = Math.max(removedBuffer.length, addedBuffer.length);
        for (let i = 0; i < count; i += 1) {
            const removed = removedBuffer[i];
            const added = addedBuffer[i];

            rows.push({
                left: removed
                    ? { type: 'deletion', text: removed }
                    : { type: 'empty', text: '' },
                right: added
                    ? { type: 'addition', text: added }
                    : { type: 'empty', text: '' },
            });
        }

        removedBuffer.length = 0;
        addedBuffer.length = 0;
    }

    for (const line of patch.split('\n')) {
        if (line.startsWith('@@')) {
            flushBuffers();
            rows.push({
                left: { type: 'hunk', text: line },
                right: { type: 'hunk', text: line },
            });
            continue;
        }

        if (line.startsWith('+++') || line.startsWith('---')) {
            flushBuffers();
            rows.push({
                left: { type: 'hunk', text: line },
                right: { type: 'hunk', text: line },
            });
            continue;
        }

        if (line.startsWith('-')) {
            removedBuffer.push(line);
            continue;
        }

        if (line.startsWith('+')) {
            addedBuffer.push(line);
            continue;
        }

        if (line.startsWith('\\')) {
            flushBuffers();
            rows.push({
                left: { type: 'notice', text: line },
                right: { type: 'notice', text: line },
            });
            continue;
        }

        flushBuffers();
        rows.push({
            left: { type: 'context', text: line },
            right: { type: 'context', text: line },
        });
    }

    flushBuffers();
    return rows;
}

function lineClass(type: UnifiedLineType | SplitCell['type']): string {
    switch (type) {
        case 'addition':
            return styles.addition;
        case 'deletion':
            return styles.deletion;
        case 'hunk':
            return styles.hunk;
        case 'meta':
            return styles.meta;
        case 'notice':
            return styles.notice;
        case 'empty':
            return styles.empty;
        default:
            return styles.context;
    }
}

export default function DiffViewer({ patch, mode = 'unified', emptyMessage = 'No textual diff is available for this file.' }: DiffViewerProps) {
    const normalizedPatch = (patch || '').trimEnd();

    const unifiedLines = useMemo(
        () => (normalizedPatch ? parseUnifiedLines(normalizedPatch) : []),
        [normalizedPatch]
    );

    const splitRows = useMemo(
        () => (normalizedPatch ? parseSplitRows(normalizedPatch) : []),
        [normalizedPatch]
    );

    if (!normalizedPatch) {
        return <div className={styles.emptyState}>{emptyMessage}</div>;
    }

    if (mode === 'split') {
        return (
            <div className={styles.splitContainer}>
                <div className={styles.splitHeader}>
                    <span>Before</span>
                    <span>After</span>
                </div>
                <div className={styles.splitBody}>
                    {splitRows.map((row, index) => (
                        <div key={index} className={styles.splitRow}>
                            <pre className={`${styles.splitCell} ${lineClass(row.left.type)}`}>{row.left.text || ' '}</pre>
                            <pre className={`${styles.splitCell} ${lineClass(row.right.type)}`}>{row.right.text || ' '}</pre>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <pre className={styles.unifiedBody}>
            {unifiedLines.map((line, index) => (
                <div key={index} className={`${styles.unifiedLine} ${lineClass(line.type)}`}>
                    {line.text || ' '}
                </div>
            ))}
        </pre>
    );
}
