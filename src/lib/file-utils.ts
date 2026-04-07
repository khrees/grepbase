// File extensions recognized as source code
export const CODE_EXTENSIONS = new Set([
    '.js', '.jsx', '.ts', '.tsx', '.py', '.rs', '.go', '.java',
    '.cpp', '.c', '.h', '.hpp', '.rb', '.php', '.swift', '.kt',
    '.md', '.json', '.yaml', '.yml', '.toml', '.css', '.scss',
    '.html', '.xml', '.sql', '.sh', '.bash',
]);

// Maximum file size for content fetching (100KB)
export const MAX_FILE_SIZE = 100_000;

export function getFileExtension(path: string): string {
    const ext = path.split('.').pop();
    return ext ? `.${ext.toLowerCase()}` : '';
}

export function isCodeFilePath(path: string): boolean {
    return CODE_EXTENSIONS.has(getFileExtension(path));
}

export function shouldFetchFileContent(path: string, size: number | null | undefined): boolean {
    return isCodeFilePath(path) && Number(size || 0) <= MAX_FILE_SIZE;
}
