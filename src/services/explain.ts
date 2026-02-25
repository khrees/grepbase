/**
 * Code explanation service
 * Uses AI to explain commits, files, and projects
 */

import { streamText } from 'ai';
import { createAIProviderAsync, type AIProviderConfig } from './ai-providers';
import { cache, CACHE_TTL } from './cache';

function sanitizePromptInput(text: string, maxLength: number): string {
    // Strip control characters except newlines and tabs
    const cleaned = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    return cleaned.length > maxLength ? cleaned.slice(0, maxLength) : cleaned;
}

// Helper to return cached text in the same format as toTextStreamResponse()
function createCachedResponse(text: string): Response {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        start(controller) {
            controller.enqueue(encoder.encode(text));
            controller.close();
        }
    });
    return new Response(stream, {
        headers: {
            'Content-Type': 'text/plain; charset=utf-8',
        },
    });
}

// Helper to generate a hash for cache keys
async function sha256(str: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function extractChangedFilesFromDiff(diff: string | null, limit = 40): string[] {
    if (!diff) return [];

    const files = new Set<string>();
    const regex = /^diff --git a\/(.+?) b\/(.+)$/gm;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(diff)) !== null) {
        const nextPath = match[2] !== '/dev/null' ? match[2] : match[1];
        if (nextPath && nextPath !== '/dev/null') {
            files.add(nextPath);
        }
        if (files.size >= limit) break;
    }

    return Array.from(files);
}

export interface CommitContext {
    sha: string;
    message: string;
    authorName: string | null;
    date: Date;
    diff: string | null;
    filesChanged: string[];
    availableFiles?: string[];
}

export interface FileContext {
    path: string;
    content: string;
    language: string;
}

export interface ProjectContext {
    name: string;
    description: string | null;
    readme: string | null;
    totalCommits: number;
    currentCommitIndex: number;
}

export interface StoryCommit {
    sha: string;
    message: string;
    authorName: string | null;
    date: Date;
}

/**
 * Generate a streaming explanation for a commit
 */
export async function explainCommit(
    commit: CommitContext,
    project: ProjectContext,
    providerConfig: AIProviderConfig
): Promise<Response> {
    const model = await createAIProviderAsync(providerConfig);
    const rawCommitTitle = commit.message.split('\n')[0]?.trim() || commit.sha.substring(0, 7);
    const shortCommitTitle = rawCommitTitle.length > 50
        ? `${rawCommitTitle.slice(0, 50).trimEnd()}...`
        : rawCommitTitle;
    const availableFiles = Array.from(
        new Set((commit.availableFiles || []).map(path => path.trim()).filter(Boolean))
    );
    const availableFileSet = new Set(availableFiles);
    const changedFiles = commit.filesChanged.length > 0
        ? commit.filesChanged
        : extractChangedFilesFromDiff(commit.diff);
    const openableChangedFiles = availableFileSet.size > 0
        ? changedFiles.filter(file => availableFileSet.has(file))
        : changedFiles;
    const changedFilesMarkdown = openableChangedFiles.length > 0
        ? openableChangedFiles.map(file => `- ${file}`).join('\n')
        : availableFileSet.size > 0
            ? '- None (no changed files from this commit are openable in the current UI view)'
            : '- Unknown';

    const systemPrompt = `You are an expert code reviewer guiding developers through a codebase's evolution.

Project: ${sanitizePromptInput(project.name, 200)}
${project.description ? `Description: ${sanitizePromptInput(project.description, 1000)}` : ''}
Progress: Commit ${project.currentCommitIndex} of ${project.totalCommits}

Analyze this commit within the context of the repository at this point in time. Explain intent, implementation details, and impact with enough technical depth for an engineer onboarding to the codebase.

Output requirements:
- Return plain markdown only.
- Do not wrap the response in triple backticks.
- Start with a level-1 heading that uses the provided short commit title (no commit SHA in the heading).
- Use these sections in order:
  1. ## Executive Summary
  2. ## Critical Files
  3. ## Implementation Deep Dive
  4. ## Architecture & Impact
  5. ## Risks, Gaps, and Next Steps
- In "Critical Files", list 3-8 most important files changed in this commit.
- Every file in "Critical Files" must use this exact link format:
  - [\`path/to/file.ext\`](file:path/to/file.ext): why this file is important
- Only reference files that appear in the provided "Changed Files (Openable in UI)" list.
- Do not generate file links for package names or dependencies (e.g. @scope/pkg).
- If the openable list is empty, explicitly say no openable changed files are available and avoid inventing file paths.
- Prioritize concrete implementation details over generic statements.`;

    const userPrompt = `Explain this commit:

**Short Commit Title (max 50 chars):** ${shortCommitTitle}
**Commit SHA:** ${commit.sha.substring(0, 7)}
**Message:** ${sanitizePromptInput(commit.message, 2000)}
**Author:** ${sanitizePromptInput(commit.authorName || 'Unknown', 200)}
**Date:** ${commit.date.toLocaleDateString()}

**Changed Files (Openable in UI):**
${changedFilesMarkdown}

${commit.diff ? `**Diff:**\n\`\`\`diff\n${commit.diff.substring(0, 7000)}${commit.diff.length > 7000 ? '\n... (truncated)' : ''}\n\`\`\`` : ''}`;

    const cacheKey = `explain:commit:${commit.sha}:${await sha256(systemPrompt + userPrompt + (providerConfig.model || 'default'))}`;

    // Check cache
    const cached = await cache.get<string>(cacheKey);
    if (cached) {
        return createCachedResponse(cached);
    }

    const result = streamText({
        model,
        system: systemPrompt,
        prompt: userPrompt,
        maxOutputTokens: 1400,
        onFinish: ({ text }) => {
            cache.set(cacheKey, text, CACHE_TTL.WEEK);
        },
    });

    return result.toTextStreamResponse();
}

/**
 * Generate a streaming explanation for a specific file
 */
export async function explainFile(
    file: FileContext,
    project: ProjectContext,
    providerConfig: AIProviderConfig
): Promise<Response> {
    const model = await createAIProviderAsync(providerConfig);

    const systemPrompt = `You are an expert code reviewer helping developers understand a codebase.

Project: ${sanitizePromptInput(project.name, 200)}
${project.description ? `Description: ${sanitizePromptInput(project.description, 1000)}` : ''}

Explain this code file clearly and concisely. Focus on:
1. What the file does
2. Key functions/classes and their purpose
3. How it might relate to other parts of the project
4. Any important patterns or concepts used`;

    const userPrompt = `Explain this file:

**File:** ${file.path}
**Language:** ${file.language}

\`\`\`${file.language}
${file.content.substring(0, 8000)}${file.content.length > 8000 ? '\n// ... (truncated)' : ''}
\`\`\``;

    // Generate a hash of content for the cache key since we don't have SHA in FileContext
    const contentHash = await sha256(file.content);
    const cacheKey = `explain:file:${file.path}:${contentHash}:${await sha256(systemPrompt + userPrompt + (providerConfig.model || 'default'))}`;

    // Check cache
    const cached = await cache.get<string>(cacheKey);
    if (cached) {
        return createCachedResponse(cached);
    }

    const result = streamText({
        model,
        system: systemPrompt,
        prompt: userPrompt,
        maxOutputTokens: 1200,
        onFinish: ({ text }) => {
            cache.set(cacheKey, text, CACHE_TTL.WEEK);
        },
    });

    return result.toTextStreamResponse();
}

/**
 * Generate a high-level project overview
 */
export async function explainProject(
    project: ProjectContext,
    providerConfig: AIProviderConfig
): Promise<Response> {
    const model = await createAIProviderAsync(providerConfig);

    const systemPrompt = `You are an expert at explaining software projects to newcomers.
Help developers understand what this project does and how to start contributing.`;

    const userPrompt = `Give me a beginner-friendly overview of this project:

**Project:** ${sanitizePromptInput(project.name, 200)}
**Description:** ${sanitizePromptInput(project.description || 'No description', 1000)}
**Total Commits:** ${project.totalCommits}

${project.readme ? `**README:**\n${sanitizePromptInput(project.readme, 5000)}` : 'No README available.'}

Please explain:
1. What this project does (in simple terms)
2. The main technologies/concepts used
3. Good starting points for understanding the codebase
4. Tips for making your first contribution`;

    const cacheKey = `explain:project:${project.name}:${await sha256(project.readme || '')}:${await sha256(systemPrompt + userPrompt + (providerConfig.model || 'default'))}`;

    // Check cache
    const cached = await cache.get<string>(cacheKey);
    if (cached) {
        return createCachedResponse(cached);
    }

    const result = streamText({
        model,
        system: systemPrompt,
        prompt: userPrompt,
        maxOutputTokens: 1500,
        onFinish: ({ text }) => {
            cache.set(cacheKey, text, CACHE_TTL.DAY); // Project explanation might change more often?
        },
    });

    return result.toTextStreamResponse();
}

/**
 * Generate a narrative walkthrough across a range of commits
 */
export async function explainStory(
    commits: StoryCommit[],
    project: ProjectContext,
    providerConfig: AIProviderConfig,
    chapterSize: number = 5
): Promise<Response> {
    const model = await createAIProviderAsync(providerConfig);

    const normalizedChapterSize = Math.max(2, Math.min(12, chapterSize));
    const commitsList = commits
        .map((commit, index) => {
            const title = commit.message.split('\n')[0] || 'No message';
            return `${index + 1}. ${commit.sha.slice(0, 7)} - ${title} (${commit.authorName || 'Unknown'}, ${commit.date.toISOString().slice(0, 10)})`;
        })
        .join('\n');

    const systemPrompt = `You are an expert software historian helping engineers understand how a project evolved.

Turn commit history into a coherent technical story.

Output requirements:
- Return markdown only, no code fences wrapping the full output.
- Start with a single H1 title.
- Group the timeline into clear chapters with H2 headings.
- Each chapter should cover around ${normalizedChapterSize} commits and include:
  - What changed
  - Why it likely changed
  - Technical implications
- End with a short "What's next" section with concrete follow-up directions.`;

    const userPrompt = `Project: ${sanitizePromptInput(project.name, 200)}
${project.description ? `Description: ${sanitizePromptInput(project.description, 1000)}` : ''}
Total commits in project: ${project.totalCommits}
Commits in this story range: ${commits.length}

Commit list (chronological):
${commitsList}

Write a narrated walkthrough of this evolution.`;

    const cacheKey = `explain:story:${await sha256(
        project.name +
        commits.map(commit => commit.sha).join(':') +
        normalizedChapterSize +
        (providerConfig.model || 'default')
    )}`;

    const cached = await cache.get<string>(cacheKey);
    if (cached) {
        return createCachedResponse(cached);
    }

    const result = streamText({
        model,
        system: systemPrompt,
        prompt: userPrompt,
        maxOutputTokens: 1800,
        onFinish: ({ text }) => {
            cache.set(cacheKey, text, CACHE_TTL.DAY);
        },
    });

    return result.toTextStreamResponse();
}

/**
 * Answer a question about the current context
 */
export async function answerQuestion(
    question: string,
    context: {
        commit?: CommitContext;
        file?: FileContext;
        project: ProjectContext;
    },
    providerConfig: AIProviderConfig
): Promise<Response> {
    const model = await createAIProviderAsync(providerConfig);

    let contextText = `Project: ${context.project.name}\n`;

    if (context.commit) {
        contextText += `\nCurrent Commit: ${context.commit.sha.substring(0, 7)} - ${sanitizePromptInput(context.commit.message, 2000)}`;
        if (context.commit.availableFiles && context.commit.availableFiles.length > 0) {
            const visibleFiles = context.commit.availableFiles.slice(0, 200).join('\n');
            contextText += `\nVisible Files (openable in UI):\n${visibleFiles}`;
        }
    }

    if (context.file) {
        contextText += `\nCurrent File: ${context.file.path}\n\`\`\`${context.file.language}\n${context.file.content.substring(0, 4000)}\n\`\`\``;
    }

    const systemPrompt = `You are a helpful assistant explaining code to developers learning a new codebase.
Answer questions clearly and concisely using the provided context.

When referencing a repository file, format it as [\`path/to/file.ext\`](file:path/to/file.ext) so the UI can open it.
Only reference files from the "Visible Files (openable in UI)" list when that list is provided.

${contextText}`;

    // For questions, we cache based on the exact question and context
    const cacheKey = `explain:question:${await sha256(question + contextText + (providerConfig.model || 'default'))}`;

    // Check cache
    const cached = await cache.get<string>(cacheKey);
    if (cached) {
        return createCachedResponse(cached);
    }

    const result = streamText({
        model,
        system: systemPrompt,
        prompt: question,
        maxOutputTokens: 800,
        onFinish: ({ text }) => {
            cache.set(cacheKey, text, CACHE_TTL.WEEK);
        },
    });

    return result.toTextStreamResponse();
}
