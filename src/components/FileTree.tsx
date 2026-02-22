

import { useState, useMemo } from 'react';
import { ChevronRight, ChevronDown, Folder, FolderOpen, File, FileCode, FileText, FileJson, FileType, Image, Cog } from 'lucide-react';
import styles from './FileTree.module.css';
import type { FileData } from '@/types';

interface FileTreeProps {
    files: FileData[];
    selectedFile: FileData | null;
    onSelectFile: (file: FileData) => void;
}

interface TreeNode {
    name: string;
    path: string;
    isFolder: boolean;
    children: TreeNode[];
    file?: FileData;
    language?: string;
}

// Map file extensions to icon components and colors
const getFileIcon = (filename: string) => {
    const ext = filename.split('.').pop()?.toLowerCase() || '';

    // Language-based icons
    const iconMap: Record<string, { icon: typeof File; color: string }> = {
        // JavaScript/TypeScript
        'js': { icon: FileCode, color: '#f7df1e' },
        'jsx': { icon: FileCode, color: '#61dafb' },
        'ts': { icon: FileCode, color: '#3178c6' },
        'tsx': { icon: FileCode, color: '#3178c6' },
        // Web
        'html': { icon: FileCode, color: '#e34c26' },
        'css': { icon: FileCode, color: '#1572b6' },
        'scss': { icon: FileCode, color: '#cc6699' },
        'sass': { icon: FileCode, color: '#cc6699' },
        // Data
        'json': { icon: FileJson, color: '#cbcb41' },
        'yaml': { icon: FileText, color: '#cb171e' },
        'yml': { icon: FileText, color: '#cb171e' },
        'xml': { icon: FileCode, color: '#e37933' },
        // Docs
        'md': { icon: FileText, color: '#083fa1' },
        'txt': { icon: FileText, color: '#6d8086' },
        'rst': { icon: FileText, color: '#6d8086' },
        // Config
        'toml': { icon: Cog, color: '#9c4121' },
        'ini': { icon: Cog, color: '#6d8086' },
        'env': { icon: Cog, color: '#ecd53f' },
        // Images
        'png': { icon: Image, color: '#a074c4' },
        'jpg': { icon: Image, color: '#a074c4' },
        'jpeg': { icon: Image, color: '#a074c4' },
        'gif': { icon: Image, color: '#a074c4' },
        'svg': { icon: Image, color: '#ffb13b' },
        'ico': { icon: Image, color: '#a074c4' },
        'webp': { icon: Image, color: '#a074c4' },
        // Languages
        'py': { icon: FileCode, color: '#3572a5' },
        'rb': { icon: FileCode, color: '#701516' },
        'go': { icon: FileCode, color: '#00add8' },
        'rs': { icon: FileCode, color: '#dea584' },
        'java': { icon: FileCode, color: '#b07219' },
        'c': { icon: FileCode, color: '#555555' },
        'cpp': { icon: FileCode, color: '#f34b7d' },
        'h': { icon: FileCode, color: '#555555' },
        'hpp': { icon: FileCode, color: '#f34b7d' },
        'swift': { icon: FileCode, color: '#f05138' },
        'kt': { icon: FileCode, color: '#a97bff' },
        'php': { icon: FileCode, color: '#4f5d95' },
        'sh': { icon: FileCode, color: '#89e051' },
        'bash': { icon: FileCode, color: '#89e051' },
        'zsh': { icon: FileCode, color: '#89e051' },
        'sql': { icon: FileCode, color: '#e38c00' },
    };

    return iconMap[ext] || { icon: FileType, color: '#6d8086' };
};

// Build tree structure from flat file paths
function buildTree(files: FileData[]): TreeNode[] {
    const root: TreeNode[] = [];

    // Sort files: folders first, then alphabetically
    const sortedFiles = [...files].sort((a, b) => {
        return a.path.localeCompare(b.path);
    });

    for (const file of sortedFiles) {
        const parts = file.path.split('/');
        let currentLevel = root;
        let currentPath = '';

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            currentPath = currentPath ? `${currentPath}/${part}` : part;
            const isLast = i === parts.length - 1;

            let existing = currentLevel.find(node => node.name === part);

            if (!existing) {
                const newNode: TreeNode = {
                    name: part,
                    path: currentPath,
                    isFolder: !isLast,
                    children: [],
                    file: isLast ? file : undefined,
                    language: isLast ? file.language : undefined,
                };
                currentLevel.push(newNode);
                existing = newNode;
            }

            if (!isLast) {
                currentLevel = existing.children;
            }
        }
    }

    // Sort each level: folders first, then files alphabetically
    function sortLevel(nodes: TreeNode[]): TreeNode[] {
        return nodes.sort((a, b) => {
            if (a.isFolder && !b.isFolder) return -1;
            if (!a.isFolder && b.isFolder) return 1;
            return a.name.localeCompare(b.name);
        }).map(node => ({
            ...node,
            children: sortLevel(node.children),
        }));
    }

    return sortLevel(root);
}

interface TreeNodeComponentProps {
    node: TreeNode;
    depth: number;
    selectedPath: string | null;
    onSelect: (file: FileData) => void;
    expandedFolders: Set<string>;
    toggleFolder: (path: string) => void;
}

function TreeNodeComponent({
    node,
    depth,
    selectedPath,
    onSelect,
    expandedFolders,
    toggleFolder,
}: TreeNodeComponentProps) {
    const isExpanded = expandedFolders.has(node.path);
    const isSelected = selectedPath === node.path;
    const { icon: FileIcon, color } = getFileIcon(node.name);

    const handleClick = () => {
        if (node.isFolder) {
            toggleFolder(node.path);
        } else if (node.file) {
            onSelect(node.file);
        }
    };

    return (
        <div className={styles.nodeWrapper}>
            <button
                className={`${styles.node} ${isSelected ? styles.nodeSelected : ''}`}
                onClick={handleClick}
                style={{ paddingLeft: `${depth * 16 + 8}px` }}
            >
                {/* Expand/collapse icon for folders */}
                <span className={styles.expandIcon}>
                    {node.isFolder ? (
                        isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />
                    ) : (
                        <span className={styles.expandPlaceholder} />
                    )}
                </span>

                {/* File/Folder icon */}
                <span className={styles.icon} style={{ color: node.isFolder ? undefined : color }}>
                    {node.isFolder ? (
                        isExpanded ? <FolderOpen size={16} /> : <Folder size={16} />
                    ) : (
                        <FileIcon size={16} />
                    )}
                </span>

                {/* Name */}
                <span className={styles.name}>{node.name}</span>
            </button>

            {/* Children */}
            {node.isFolder && isExpanded && node.children.length > 0 && (
                <div className={styles.children}>
                    {node.children.map(child => (
                        <TreeNodeComponent
                            key={child.path}
                            node={child}
                            depth={depth + 1}
                            selectedPath={selectedPath}
                            onSelect={onSelect}
                            expandedFolders={expandedFolders}
                            toggleFolder={toggleFolder}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

export default function FileTree({ files, selectedFile, onSelectFile }: FileTreeProps) {
    // Filter to only files that should be shown
    const visibleFiles = files.filter(f => f.shouldFetchContent || f.hasContent);

    // Build tree structure
    const tree = useMemo(() => buildTree(visibleFiles), [visibleFiles]);

    // Track expanded folders - expand all by default initially
    const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => {
        const folders = new Set<string>();
        visibleFiles.forEach(file => {
            const parts = file.path.split('/');
            let path = '';
            for (let i = 0; i < parts.length - 1; i++) {
                path = path ? `${path}/${parts[i]}` : parts[i];
                folders.add(path);
            }
        });
        return folders;
    });

    const toggleFolder = (path: string) => {
        setExpandedFolders(prev => {
            const next = new Set(prev);
            if (next.has(path)) {
                next.delete(path);
            } else {
                next.add(path);
            }
            return next;
        });
    };

    if (visibleFiles.length === 0) {
        return (
            <div className={styles.empty}>
                <File size={24} />
                <span>No files</span>
            </div>
        );
    }

    return (
        <div className={styles.tree}>
            {tree.map(node => (
                <TreeNodeComponent
                    key={node.path}
                    node={node}
                    depth={0}
                    selectedPath={selectedFile?.path || null}
                    onSelect={onSelectFile}
                    expandedFolders={expandedFolders}
                    toggleFolder={toggleFolder}
                />
            ))}
        </div>
    );
}
