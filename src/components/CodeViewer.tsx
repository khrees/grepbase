

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
    const lang = langMap[language.toLowerCase()] || 'plain';

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <span className={styles.filename}>{filename}</span>
                <span className={styles.language}>{language}</span>
            </div>
            <Highlight
                theme={themes.nightOwl}
                code={code}
                language={lang}
            >
                {({ className, style, tokens, getLineProps, getTokenProps }) => (
                    <pre className={`${className} ${styles.code}`} style={style}>
                        {tokens.map((line, i) => (
                            <div key={i} {...getLineProps({ line })}>
                                <span className={styles.lineNumber}>{i + 1}</span>
                                {line.map((token, key) => (
                                    <span key={key} {...getTokenProps({ token })} />
                                ))}
                            </div>
                        ))}
                    </pre>
                )}
            </Highlight>
        </div>
    );
}
