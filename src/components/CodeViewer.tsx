
'use client';

import { useCallback, useMemo, useRef, useState, useEffect, memo } from 'react';
import { Check, Copy, FileCode2 } from 'lucide-react';
import { Highlight, themes } from 'prism-react-renderer';
import styles from './CodeViewer.module.css';

interface CodeViewerProps {
    code: string;
    language: string;
    filename: string;
}

// Map file extensions and language names to Prism language IDs
const langMap: Record<string, string> = {
    // JavaScript / TypeScript
    'javascript': 'javascript',
    'js': 'javascript',
    'mjs': 'javascript',
    'cjs': 'javascript',
    'typescript': 'typescript',
    'ts': 'typescript',
    'jsx': 'jsx',
    'tsx': 'tsx',

    // Python
    'python': 'python',
    'py': 'python',

    // Rust
    'rust': 'rust',
    'rs': 'rust',

    // Go
    'go': 'go',

    // Java / Kotlin / Swift
    'java': 'java',
    'kotlin': 'kotlin',
    'kt': 'kotlin',
    'swift': 'swift',

    // C / C++ / C#
    'c': 'c',
    'h': 'c',
    'cpp': 'cpp',
    'cxx': 'cpp',
    'cc': 'cpp',
    'hpp': 'cpp',
    'cs': 'csharp',

    // Ruby / PHP
    'ruby': 'ruby',
    'rb': 'ruby',
    'php': 'php',

    // Web / Styles / Markup
    'html': 'markup',
    'htm': 'markup',
    'xml': 'markup',
    'svg': 'markup',
    'css': 'css',
    'scss': 'scss',
    'sass': 'scss',
    'less': 'css',

    // Data / Config
    'json': 'json',
    'yaml': 'yaml',
    'yml': 'yaml',
    'toml': 'toml',
    'sql': 'sql',

    // Markdown / Docs
    'markdown': 'markdown',
    'md': 'markdown',
    'mdx': 'markdown',

    // Shell / Scripting
    'bash': 'bash',
    'sh': 'bash',
    'zsh': 'bash',
    'shell': 'bash',

    // Plain text
    'plaintext': 'plain',
    'text': 'plain',
    'txt': 'plain',
};

export default memo(function CodeViewer({ code, language, filename }: CodeViewerProps) {
    const [wrapLines, setWrapLines] = useState(false);
    const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
    const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const extFromFilename = filename ? filename.split('.').pop()?.toLowerCase() || '' : '';
    const rawLang = (language || extFromFilename || 'text').toLowerCase();
    const lang = langMap[rawLang] || 'plain';
    const displayLanguage = lang === 'plain' ? 'text' : rawLang;

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
                                            {line.map((token, tokenIndex) => {
                                                const { key: _key, ...tokenProps } = getTokenProps({ token });
                                                return (
                                                    <span
                                                        key={`token-${lineIndex}-${tokenIndex}`}
                                                        {...tokenProps}
                                                    />
                                                );
                                            })}
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
});
