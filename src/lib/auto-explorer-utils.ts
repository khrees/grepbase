/**
 * Auto-explorer utilities for UI integration
 *
 * This module provides helper functions for the UI to understand
 * when auto-exploration is beneficial and what kind of guidance
 * to provide to users.
 */

import { requiresExploration, detectPromptInjection, getExplorationGuidance } from '@/services/auto-explorer';

/**
 * Get exploration status for a question
 */
export interface ExplorationStatus {
    needsExploration: boolean;
    hasInjection: boolean;
    injectionReason?: string;
    guidance?: string;
    questionCategory?: string;
}

/**
 * Analyze a question and return exploration status
 */
export function analyzeQuestion(question: string): ExplorationStatus {
    // First check for injection
    const injection = detectPromptInjection(question);
    if (injection.isInjected) {
        return {
            needsExploration: false,
            hasInjection: true,
            injectionReason: injection.reason,
        };
    }

    // Check if exploration is needed
    const needsExploration = requiresExploration(question);
    const guidance = getExplorationGuidance(question);

    // Determine question category for categorization
    let questionCategory: string | undefined;
    const questionLower = question.toLowerCase();

    if (questionLower.includes('auth') || questionLower.includes('authentication') || questionLower.includes('login')) {
        questionCategory = 'auth';
    } else if (questionLower.includes('config') || questionLower.includes('setting') || questionLower.includes('env')) {
        questionCategory = 'config';
    } else if (questionLower.includes('database') || questionLower.includes('db') || questionLower.includes('schema')) {
        questionCategory = 'database';
    } else if (questionLower.includes('api') || questionLower.includes('endpoint') || questionLower.includes('route')) {
        questionCategory = 'api';
    } else if (questionLower.includes('test') || questionLower.includes('spec')) {
        questionCategory = 'testing';
    } else if (needsExploration) {
        questionCategory = 'exploration';
    }

    return {
        needsExploration,
        hasInjection: false,
        guidance: guidance || undefined,
        questionCategory,
    };
}

/**
 * Get exploration hints based on question type
 */
export function getExplorationHints(question: string): string[] {
    const hints: string[] = [];

    const status = analyzeQuestion(question);

    if (status.hasInjection) {
        return ['[Security Alert: Question contains potential injection attempt]'];
    }

    if (status.needsExploration) {
        if (status.guidance) {
            hints.push(`Consider exploring:\n${status.guidance}`);
        }

        hints.push('You can also use LSP tools to explore the codebase:');
        hints.push('- `goToDefinition` - Jump to function/class definitions');
        hints.push('- `findReferences` - Find all usages of a symbol');
        hints.push('- `workspaceSymbol` - Search for symbols across the project');
    }

    return hints;
}

/**
 * Check if a question should trigger auto-exploration
 */
export function shouldEnableAutoExplore(question: string): boolean {
    const status = analyzeQuestion(question);
    return status.needsExploration && !status.hasInjection;
}

/**
 * Get the UI hint text for an exploration-enabled question
 */
export function getExplorationHintText(question: string): string | null {
    const hints = getExplorationHints(question);
    if (hints.length > 0 && !hints[0].startsWith('[Security')) {
        return hints.join('\n');
    }
    return null;
}
