/**
 * Code explanation service
 * Uses AI to explain commits, files, and projects
 */

import { streamText, type StreamTextResult } from 'ai';
import { createAIProviderAsync, type AIProviderConfig } from './ai-providers';
import { cache, CACHE_TTL } from './cache';

/**
 * Interface for cached explanation responses that mimics StreamTextResult
 */
interface CachedStreamResult {
    toTextStreamResponse: () => Response;
    text: Promise<string>;
}

type ExplainResult = StreamTextResult<Record<string, never>, never> | CachedStreamResult;

// Helper to generate a hash for cache keys
async function sha256(str: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export interface CommitContext {
    sha: string;
    message: string;
    authorName: string | null;
    date: Date;
    diff: string | null;
    filesChanged: string[];
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

/**
 * Generate a streaming explanation for a commit
 */
export async function explainCommit(
    commit: CommitContext,
    project: ProjectContext,
    providerConfig: AIProviderConfig
): Promise<ExplainResult> {
    const model = await createAIProviderAsync(providerConfig);

    const systemPrompt = `You are an expert code reviewer guiding developers through a codebase's evolution.

Project: ${project.name}
${project.description ? `Description: ${project.description}` : ''}
Progress: Commit ${project.currentCommitIndex} of ${project.totalCommits}

Analyze this commit within the context of the repository at this point in time. Provide a cohesive explanation that captures the intent behind the changes—what problem they solve or what capability they introduce—and how this work advances the project's overarching purpose. Draw connections between the technical implementation and the product vision, helping the reader understand not just what changed, but why it matters in the broader narrative of this project's development.

Be concise yet insightful. Use markdown formatting.`;

    const userPrompt = `Explain this commit:

**Commit:** ${commit.sha.substring(0, 7)}
**Message:** ${commit.message}
**Author:** ${commit.authorName || 'Unknown'}
**Date:** ${commit.date.toLocaleDateString()}

**Files Changed:** ${commit.filesChanged.length > 0 ? commit.filesChanged.join(', ') : 'Unknown'}

${commit.diff ? `**Diff:**\n\`\`\`diff\n${commit.diff.substring(0, 2000)}${commit.diff.length > 2000 ? '\n... (truncated)' : ''}\n\`\`\`` : ''}`;

    const cacheKey = `explain:commit:${commit.sha}:${await sha256(systemPrompt + userPrompt + (providerConfig.model || 'default'))}`;

    // Check cache
    const cached = await cache.get<string>(cacheKey);
    if (cached) {
        const cachedResult: CachedStreamResult = {
            toTextStreamResponse: () => new Response(cached),
            text: Promise.resolve(cached),
        };
        return cachedResult;
    }

    return streamText({
        model,
        system: systemPrompt,
        prompt: userPrompt,
        maxOutputTokens: 1000,
        onFinish: ({ text }) => {
            cache.set(cacheKey, text, CACHE_TTL.WEEK);
        },
    });
}

/**
 * Generate a streaming explanation for a specific file
 */
export async function explainFile(
    file: FileContext,
    project: ProjectContext,
    providerConfig: AIProviderConfig
): Promise<ExplainResult> {
    const model = await createAIProviderAsync(providerConfig);

    const systemPrompt = `You are an expert code reviewer helping developers understand a codebase.

Project: ${project.name}
${project.description ? `Description: ${project.description}` : ''}

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
        const cachedResult: CachedStreamResult = {
            toTextStreamResponse: () => new Response(cached),
            text: Promise.resolve(cached),
        };
        return cachedResult;
    }

    return streamText({
        model,
        system: systemPrompt,
        prompt: userPrompt,
        maxOutputTokens: 1200,
        onFinish: ({ text }) => {
            cache.set(cacheKey, text, CACHE_TTL.WEEK);
        },
    });
}

/**
 * Generate a high-level project overview
 */
export async function explainProject(
    project: ProjectContext,
    providerConfig: AIProviderConfig
): Promise<ExplainResult> {
    const model = await createAIProviderAsync(providerConfig);

    const systemPrompt = `You are an expert at explaining software projects to newcomers.
Help developers understand what this project does and how to start contributing.`;

    const userPrompt = `Give me a beginner-friendly overview of this project:

**Project:** ${project.name}
**Description:** ${project.description || 'No description'}
**Total Commits:** ${project.totalCommits}

${project.readme ? `**README:**\n${project.readme.substring(0, 5000)}${project.readme.length > 5000 ? '\n... (truncated)' : ''}` : 'No README available.'}

Please explain:
1. What this project does (in simple terms)
2. The main technologies/concepts used
3. Good starting points for understanding the codebase
4. Tips for making your first contribution`;

    const cacheKey = `explain:project:${project.name}:${await sha256(project.readme || '')}:${await sha256(systemPrompt + userPrompt + (providerConfig.model || 'default'))}`;

    // Check cache
    const cached = await cache.get<string>(cacheKey);
    if (cached) {
        const cachedResult: CachedStreamResult = {
            toTextStreamResponse: () => new Response(cached),
            text: Promise.resolve(cached),
        };
        return cachedResult;
    }

    return streamText({
        model,
        system: systemPrompt,
        prompt: userPrompt,
        maxOutputTokens: 1500,
        onFinish: ({ text }) => {
            cache.set(cacheKey, text, CACHE_TTL.DAY); // Project explanation might change more often?
        },
    });
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
): Promise<ExplainResult> {
    const model = await createAIProviderAsync(providerConfig);

    let contextText = `Project: ${context.project.name}\n`;

    if (context.commit) {
        contextText += `\nCurrent Commit: ${context.commit.sha.substring(0, 7)} - ${context.commit.message}`;
    }

    if (context.file) {
        contextText += `\nCurrent File: ${context.file.path}\n\`\`\`${context.file.language}\n${context.file.content.substring(0, 4000)}\n\`\`\``;
    }

    const systemPrompt = `You are a helpful assistant explaining code to developers learning a new codebase.
Answer questions clearly and concisely using the provided context.

${contextText}`;

    // For questions, we cache based on the exact question and context
    const cacheKey = `explain:question:${await sha256(question + contextText + (providerConfig.model || 'default'))}`;

    // Check cache
    const cached = await cache.get<string>(cacheKey);
    if (cached) {
        const cachedResult: CachedStreamResult = {
            toTextStreamResponse: () => new Response(cached),
            text: Promise.resolve(cached),
        };
        return cachedResult;
    }

    return streamText({
        model,
        system: systemPrompt,
        prompt: question,
        maxOutputTokens: 800,
        onFinish: ({ text }) => {
            cache.set(cacheKey, text, CACHE_TTL.WEEK);
        },
    });
}
