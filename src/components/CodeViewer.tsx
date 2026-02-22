
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, FileCode2 } from 'lucide-react';
import { Highlight, themes } from 'prism-react-renderer';
import styles from './CodeViewer.module.css';

interface CodeViewerProps {
    code: string;
    language: string;
    filename: string;
}

// Map common language names to Prism language IDs
const langMap: Record<string, string> = {
    'javascript': 'javascript',
    'typescript': 'typescript',
    'jsx': 'jsx',
    'tsx': 'tsx',
    'python': 'python',
    'rust': 'rust',
    'go': 'go',
    'java': 'java',
    'cpp': 'cpp',
    'c': 'c',
    'ruby': 'ruby',
    'php': 'php',
    'swift': 'swift',
    'kotlin': 'kotlin',
    'markdown': 'markdown',
    'json': 'json',
    'yaml': 'yaml',
    'css': 'css',
    'scss': 'scss',
    'html': 'markup',
    'xml': 'markup',
    'sql': 'sql',
    'bash': 'bash',
    'shell': 'bash',
    'plaintext': 'plain',
};

export default function CodeViewer({ code, language, filename }: CodeViewerProps) {
    const [wrapLines, setWrapLines] = useState(false);
    const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
    const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const normalizedLanguage = (language || 'text').toLowerCase();
    const lang = langMap[normalizedLanguage] || 'plain';
    const displayLanguage = lang === 'plain' ? 'text' : normalizedLanguage;

    const lineCount = useMemo(() => {
        if (!code) return 0;
        return code.split('\n').length;
    }, [code]);

    useEffect(() => {
        return () => {
            if (copyResetTimerRef.current) {
                clearTimeout(copyResetTimerRef.current);
            }
        };
    }, []);

    const handleCopy = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(code);
            setCopyState('copied');
        } catch {
            setCopyState('error');
        }

        if (copyResetTimerRef.current) {
            clearTimeout(copyResetTimerRef.current);
        }

        copyResetTimerRef.current = setTimeout(() => {
            setCopyState('idle');
        }, 1800);
    }, [code]);

    return (
        <div className={styles.container}>
            <div className={styles.toolbar}>
                <div className={styles.toolbarLeft}>
                    <span className={styles.fileBadge}>
                        <FileCode2 size={14} />
                        <span className={styles.filename} title={filename}>
                            {filename}
                        </span>
                    </span>
                    <span className={styles.language}>{displayLanguage}</span>
                </div>

                <div className={styles.toolbarRight}>
                    <span className={styles.lineCount}>{lineCount} lines</span>
                    <button
                        type="button"
                        className={`${styles.actionBtn} ${wrapLines ? styles.actionBtnActive : ''}`}
                        onClick={() => setWrapLines(prev => !prev)}
                        aria-pressed={wrapLines}
                        aria-label={wrapLines ? 'Disable line wrap' : 'Enable line wrap'}
                    >
                        Wrap
                    </button>
                    <button
                        type="button"
                        className={`${styles.actionBtn} ${styles.copyBtn}`}
                        onClick={handleCopy}
                        aria-label="Copy code to clipboard"
                    >
                        {copyState === 'copied' ? <Check size={14} /> : <Copy size={14} />}
                        <span>{copyState === 'copied' ? 'Copied' : 'Copy'}</span>
                    </button>
                </div>
            </div>

            <div className={styles.viewport}>
                <Highlight
                    theme={themes.nightOwl}
                    code={code}
                    language={lang}
                >
                    {({ className, style, tokens, getTokenProps }) => {
                        const displayTokens =
                            tokens.length > 1 &&
                                tokens[tokens.length - 1]?.length === 1 &&
                                tokens[tokens.length - 1][0]?.content === ''
                                ? tokens.slice(0, -1)
                                : tokens;

                        return (
                            <pre
                                className={`${className} ${styles.code} ${wrapLines ? styles.wrapLines : ''}`}
                                style={style}
                            >
                                {displayTokens.map((line, lineIndex) => (
                                    <div key={`line-${lineIndex}`} className={styles.codeLine}>
                                        <span className={styles.lineNumber} aria-hidden>
                                            {lineIndex + 1}
                                        </span>
                                        <span className={styles.lineContent}>
                                            {line.map((token, tokenIndex) => (
                                                <span
                                                    key={`token-${lineIndex}-${tokenIndex}`}
                                                    {...getTokenProps({ token, key: tokenIndex })}
                                                />
                                            ))}
                                        </span>
                                    </div>
                                ))}
                            </pre>
                        );
                    }}
                </Highlight>
            </div>

            <span className={styles.srOnly} aria-live="polite">
                {copyState === 'copied' ? 'Code copied to clipboard' : ''}
            </span>
        </div>
    );
}
