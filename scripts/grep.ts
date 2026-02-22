#!/usr/bin/env bun

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
// exec/promisify removed - not currently used


interface FileInfo {
    path: string;
    relativePath: string;
    size: number;
    ext: string;
    hash?: string;
}

interface FileAnalysis {
    functions: string[];
    classes: string[];
    imports: string[];
    exports: string[];
}

interface FileSummary {
    file: string;
    summary: string;
    relationships: string[];
    purpose: string;
    complexity: 'low' | 'medium' | 'high';
    timestamp: string;
}

interface PreprocessedFile {
    path: string;
    ext: string;
    size: number;
    hash?: string;
}

interface PreprocessedBatch {
    batch: PreprocessedFile[];
    analysis: string;
    timestamp: string;
}

interface ChatCompletionResponse {
    choices?: Array<{
        message?: {
            content?: string;
        };
    }>;
}

class GrepBase {
    options: {
        maxFileSize: number;
        maxBatchSize: number;
        supportedExtensions: string[];
        cacheDir: string;
        outputDir: string;
        summaryDir: string;
        localLlmUrl: string;
        enableSummarization: boolean;
    };
    stats: {
        filesProcessed: number;
        cacheHits: number;
        cacheMisses: number;
        summariesGenerated: number;
        summariesFromCache: number;
    };

    constructor(options = {}) {
        this.options = {
            maxFileSize: 50000,
            maxBatchSize: 5,
            supportedExtensions: ['.js', '.ts', '.py', '.rs', '.go', '.java', '.cpp', '.c', '.rb', '.php', '.swift', '.kt'],
            cacheDir: './cache',
            outputDir: './output',
            summaryDir: './tmp',
            localLlmUrl: 'http://localhost:1234/v1/chat/completions',
            enableSummarization: false,
            ...options
        };

        this.stats = {
            filesProcessed: 0,
            cacheHits: 0,
            cacheMisses: 0,
            summariesGenerated: 0,
            summariesFromCache: 0
        };

        this.ensureDirectories();
    }

    ensureDirectories() {
        [this.options.cacheDir, this.options.outputDir, this.options.summaryDir].forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        });
    }

    // Phase 1: File Discovery (existing)
    async discoverFiles(repoPath: string): Promise<FileInfo[]> {
        console.log(`🔍 Discovering files in: ${repoPath}`);
        const files: FileInfo[] = [];

        const walk = (dir: string) => {
            const items = fs.readdirSync(dir);
            for (const item of items) {
                const fullPath = path.join(dir, item);
                const stat = fs.statSync(fullPath);
                if (stat.isDirectory()) {
                    if (this.shouldIgnoreDirectory(item)) continue;
                    walk(fullPath);
                } else if (stat.isFile()) {
                    if (this.shouldIncludeFile(fullPath, stat.size)) {
                        const content = fs.readFileSync(fullPath, 'utf8');
                        const hash = crypto.createHash('md5').update(content).digest('hex');
                        files.push({
                            path: fullPath,
                            relativePath: path.relative(repoPath, fullPath),
                            size: stat.size,
                            ext: path.extname(fullPath),
                            hash
                        });
                    }
                }
            }
        };

        walk(repoPath);
        console.log(`📁 Found ${files.length} relevant files`);
        return files;
    }

    shouldIgnoreDirectory(dirname: string): boolean {
        const ignorePatterns = [
            'node_modules', '.git', '.vscode', '.idea', 'build', 'dist',
            'target', 'vendor', '__pycache__', '.pytest_cache', 'coverage'
        ];
        return ignorePatterns.includes(dirname) || dirname.startsWith('.');
    }

    shouldIncludeFile(filePath: string, fileSize: number): boolean {
        const ext = path.extname(filePath);
        return this.options.supportedExtensions.includes(ext) &&
            fileSize <= this.options.maxFileSize;
    }

    // Phase 1: Basic Analysis (enhanced)
    async preprocessWithLocalLLM(files: FileInfo[]): Promise<PreprocessedBatch[]> {
        console.log(`🤖 Preprocessing ${files.length} files with local LLM...`);
        const batches = this.chunkFiles(files, this.options.maxBatchSize);
        const preprocessedBatches: PreprocessedBatch[] = [];

        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            console.log(`📦 Processing batch ${i + 1}/${batches.length} (${batch.length} files)`);
            const batchHash = this.generateBatchHash(batch);
            const cacheFile = path.join(this.options.cacheDir, `preprocess_${batchHash}.json`);

            if (fs.existsSync(cacheFile)) {
                console.log(`✅ Cache hit for batch ${i + 1}`);
                const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
                preprocessedBatches.push(cached);
                this.stats.cacheHits++;
                continue;
            }

            const preprocessed = await this.callLocalLLM(batch);
            fs.writeFileSync(cacheFile, JSON.stringify(preprocessed, null, 2));
            preprocessedBatches.push(preprocessed);
            this.stats.cacheMisses++;
            await this.sleep(500);
        }

        return preprocessedBatches;
    }

    async callLocalLLM(batch: FileInfo[]): Promise<PreprocessedBatch> {
        const prompt = this.buildPreprocessingPrompt(batch);

        try {
            const analysis = await this.generateChatCompletion({
                model: 'meta-llama-3.1-8b-instruct',
                messages: [
                    {
                        role: 'system',
                        content: 'You are a code analysis assistant. Analyze the provided code files and extract key structural information, dependencies, and purpose. Be concise and structured.',
                    },
                    {
                        role: 'user',
                        content: prompt,
                    },
                ],
                temperature: 0.1,
                max_tokens: 2000,
            });

            return {
                batch: batch.map(f => ({
                    path: f.relativePath,
                    ext: f.ext,
                    size: f.size,
                    hash: f.hash
                })),
                analysis: analysis,
                timestamp: new Date().toISOString()
            };
        } catch (error: unknown) {
            console.error(`❌ Local LLM error:`, (error as Error).message);
            return {
                batch: batch.map(f => ({
                    path: f.relativePath,
                    ext: f.ext,
                    size: f.size,
                    hash: f.hash
                })),
                analysis: "Error: Could not analyze with local LLM",
                timestamp: new Date().toISOString()
            };
        }
    }

    buildPreprocessingPrompt(batch: FileInfo[]): string {
        let prompt = `Analyze these ${batch.length} code files and extract their structure:\n\n`;

        batch.forEach((file, index) => {
            const content = fs.readFileSync(file.path, 'utf8');
            prompt += `File ${index + 1}: ${file.relativePath}\n`;
            prompt += `Language: ${this.getLanguageFromExtension(file.ext)}\n`;
            prompt += `Size: ${file.size} bytes\n`;
            prompt += `Content:\n${content.substring(0, 1500)}${content.length > 1500 ? '...' : ''}\n\n`;
        });

        prompt += `For each file, extract:
1. Functions/methods (names only)
2. Classes/types/interfaces (names only)  
3. Main imports/dependencies
4. Primary purpose (1 sentence)
5. File relationships/dependencies

Format as structured text for easy parsing.`;

        return prompt;
    }

    // 🧠 PHASE 2: LLM-Aided Code Summarization
    async generateFileSummaries(files: FileInfo[]): Promise<FileSummary[]> {
        if (!this.options.enableSummarization) {
            console.log(`⏭️  Skipping summarization (use --summarize flag to enable)`);
            return [];
        }

        console.log(`📝 Generating detailed summaries for ${files.length} files...`);
        const summaries: FileSummary[] = [];

        for (const file of files) {
            console.log(`🔍 Summarizing: ${file.relativePath}`);

            // Check cache using file hash
            const cacheFile = path.join(this.options.summaryDir, `summary_${file.hash}.json`);

            if (fs.existsSync(cacheFile)) {
                console.log(`✅ Summary cache hit: ${file.relativePath}`);
                const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
                summaries.push(cached);
                this.stats.summariesFromCache++;
                continue;
            }

            // Generate new summary
            const summary = await this.generateFileSummary(file);

            // Cache the result
            fs.writeFileSync(cacheFile, JSON.stringify(summary, null, 2));
            summaries.push(summary);
            this.stats.summariesGenerated++;

            // Rate limiting
            await this.sleep(300);
        }

        // Save all summaries
        const summaryFile = path.join(this.options.summaryDir, 'grepbase_summaries.json');
        fs.writeFileSync(summaryFile, JSON.stringify(summaries, null, 2));
        console.log(`📋 Summaries saved to: ${summaryFile}`);

        return summaries;
    }

    async generateFileSummary(file: FileInfo): Promise<FileSummary> {
        const content = fs.readFileSync(file.path, 'utf8');
        const prompt = this.buildSummaryPrompt(file, content);

        try {
            const analysis = await this.generateChatCompletion({
                model: 'meta-llama-3.1-8b-instruct',
                messages: [
                    {
                        role: 'system',
                        content: `You are an expert code analyst. Analyze the given code file and provide a clear, concise summary focusing on:
1. What the file does (primary purpose)
2. How it relates to other parts of the codebase
3. Key components and their roles
4. Complexity assessment

Be specific and actionable. Avoid generic descriptions.`
                    },
                    {
                        role: 'user',
                        content: prompt,
                    }
                ],
                temperature: 0.2,
                max_tokens: 800
            });

            // Parse the LLM response to extract structured data
            return this.parseFileSummaryResponse(file, analysis);

        } catch (error: unknown) {
            console.error(`❌ Summary error for ${file.relativePath}:`, (error as Error).message);
            return {
                file: file.relativePath,
                summary: `Error generating summary: ${(error as Error).message}`,
                relationships: [],
                purpose: "Unknown due to analysis error",
                complexity: 'medium',
                timestamp: new Date().toISOString()
            };
        }
    }

    async generateChatCompletion(payload: {
        model: string;
        messages: Array<{ role: string; content: string }>;
        temperature: number;
        max_tokens: number;
    }): Promise<string> {
        const response = await fetch(this.options.localLlmUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            throw new Error(`Local LLM request failed: ${response.status} ${response.statusText}`);
        }

        const data = await response.json() as ChatCompletionResponse;
        const content = data.choices?.[0]?.message?.content;
        if (!content) {
            throw new Error('Local LLM returned an empty response');
        }

        return content;
    }

    buildSummaryPrompt(file: FileInfo, content: string): string {
        // Extract basic structure first
        const structure = this.extractBasicStructure(file.ext, content);

        return `Analyze this ${this.getLanguageFromExtension(file.ext)} file:

File: ${file.relativePath}
Size: ${file.size} bytes

Detected structure:
- Functions: ${structure.functions.join(', ') || 'none'}
- Classes/Types: ${structure.classes.join(', ') || 'none'}  
- Imports: ${structure.imports.slice(0, 5).join(', ')}${structure.imports.length > 5 ? '...' : ''}

Source code:
${content}

Please provide:
1. **Purpose**: What does this file do? (2-3 sentences)
2. **Relationships**: What other files/modules does it likely interact with?
3. **Complexity**: Is this file simple, moderate, or complex in terms of logic/responsibilities?
4. **Key Components**: What are the main functions/classes and what do they do?

Be specific to THIS file, not generic.`;
    }

    extractBasicStructure(ext: string, content: string): FileAnalysis {
        const structure: FileAnalysis = {
            functions: [],
            classes: [],
            imports: [],
            exports: []
        };

        const lines = content.split('\n');

        for (const line of lines) {
            const trimmed = line.trim();

            // Extract imports (basic patterns for multiple languages)
            if (trimmed.startsWith('import ') || trimmed.startsWith('from ') ||
                trimmed.startsWith('#include') || trimmed.startsWith('use ')) {
                structure.imports.push(trimmed);
            }

            // Extract functions (basic patterns)
            const funcMatches = trimmed.match(/(?:function|def|func|fn|public|private|protected)?\s*(\w+)\s*\(/);
            if (funcMatches && !trimmed.startsWith('//') && !trimmed.startsWith('*')) {
                structure.functions.push(funcMatches[1]);
            }

            // Extract classes/interfaces/types
            const classMatches = trimmed.match(/(?:class|interface|type|struct|enum)\s+(\w+)/);
            if (classMatches && !trimmed.startsWith('//') && !trimmed.startsWith('*')) {
                structure.classes.push(classMatches[1]);
            }
        }

        return structure;
    }

    parseFileSummaryResponse(file: FileInfo, response: string): FileSummary {
        // Simple parsing of the LLM response
        const lines = response.split('\n');
        let summary = '';
        let purpose = '';
        let relationships: string[] = [];
        let complexity: 'low' | 'medium' | 'high' = 'medium';

        // Extract key information from the response
        for (const line of lines) {
            if (line.toLowerCase().includes('purpose') && line.includes(':')) {
                purpose = line.split(':').slice(1).join(':').trim();
            }
            if (line.toLowerCase().includes('relationship') && line.includes(':')) {
                const relationshipText = line.split(':').slice(1).join(':').trim();
                relationships = relationshipText.split(',').map(r => r.trim()).filter(r => r.length > 0);
            }
            if (line.toLowerCase().includes('complexity') && line.includes(':')) {
                const complexityText = line.split(':').slice(1).join(':').toLowerCase().trim();
                if (complexityText.includes('simple') || complexityText.includes('low')) {
                    complexity = 'low';
                } else if (complexityText.includes('complex') || complexityText.includes('high')) {
                    complexity = 'high';
                }
            }
        }

        // Use the full response as summary if we couldn't parse specific parts
        summary = purpose || response.slice(0, 300) + (response.length > 300 ? '...' : '');

        return {
            file: file.relativePath,
            summary,
            relationships,
            purpose: purpose || summary,
            complexity,
            timestamp: new Date().toISOString()
        };
    }

    // Utility methods (existing + enhanced)
    chunkFiles(files: FileInfo[], batchSize: number): FileInfo[][] {
        const chunks = [];
        for (let i = 0; i < files.length; i += batchSize) {
            chunks.push(files.slice(i, i + batchSize));
        }
        return chunks;
    }

    generateBatchHash(batch: FileInfo[]): string {
        const batchString = batch.map(f => f.relativePath + f.hash).join('|');
        return crypto.createHash('md5').update(batchString).digest('hex');
    }

    getLanguageFromExtension(ext: string): string {
        const langMap: Record<string, string> = {
            '.js': 'JavaScript',
            '.ts': 'TypeScript',
            '.py': 'Python',
            '.rs': 'Rust',
            '.go': 'Go',
            '.java': 'Java',
            '.cpp': 'C++',
            '.c': 'C',
            '.rb': 'Ruby',
            '.php': 'PHP',
            '.swift': 'Swift',
            '.kt': 'Kotlin'
        };
        return langMap[ext] || 'Unknown';
    }

    sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Enhanced output generation
    async generateOutput(preprocessedBatches: PreprocessedBatch[], summaries: FileSummary[] = []): Promise<string> {
        const output = {
            metadata: {
                timestamp: new Date().toISOString(),
                toolVersion: "2.0.0",
                stats: this.stats,
                hasSummaries: summaries.length > 0
            },
            structure: preprocessedBatches,
            summaries: summaries.length > 0 ? summaries : undefined
        };

        const outputFile = path.join(this.options.outputDir, 'grepbase_analysis.json');
        fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));

        console.log(`📊 Analysis complete! Results saved to: ${outputFile}`);
        console.log(`📈 Stats:`);
        console.log(`  - Files processed: ${this.stats.filesProcessed}`);
        console.log(`  - Cache hits: ${this.stats.cacheHits}`);
        console.log(`  - Cache misses: ${this.stats.cacheMisses}`);
        if (summaries.length > 0) {
            console.log(`  - Summaries generated: ${this.stats.summariesGenerated}`);
            console.log(`  - Summaries from cache: ${this.stats.summariesFromCache}`);
        }

        return outputFile;
    }

    // Main execution
    async run(repoPath: string): Promise<string> {
        console.log(`🚀 GrepBase starting analysis of: ${repoPath}`);

        try {
            // Phase 1: File discovery and basic analysis
            const files = await this.discoverFiles(repoPath);
            this.stats.filesProcessed = files.length;

            const preprocessed = await this.preprocessWithLocalLLM(files);

            // Phase 2: Detailed summarization (optional)
            const summaries = await this.generateFileSummaries(files);

            // Generate final output
            const outputFile = await this.generateOutput(preprocessed, summaries);

            console.log(`✅ GrepBase analysis complete!`);
            return outputFile;

        } catch (error: unknown) {
            console.error(`❌ GrepBase error:`, error);
            throw error;
        }
    }
}

// CLI Usage
if (require.main === module) {
    const args = process.argv.slice(2);
    const repoPath = args.find(arg => !arg.startsWith('--'));
    const shouldSummarize = args.includes('--summarize');

    if (!repoPath) {
        console.log(`Usage: node grepbase.js /path/to/repo [--summarize]`);
        console.log(`Options:`);
        console.log(`  --summarize    Enable Phase 2 detailed file summarization`);
        process.exit(1);
    }

    const grepbase = new GrepBase({ enableSummarization: shouldSummarize });
    grepbase.run(repoPath)
        .then(outputFile => {
            console.log(`🎉 Success! Check ${outputFile} for results`);
        })
        .catch(error => {
            console.error(`💥 Failed:`, error.message);
            process.exit(1);
        });
}

export default GrepBase;
