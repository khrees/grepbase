/**
 * Auto-exploration service for answering codebase questions
 *
 * When a question is asked, this service can:
 * 1. Detect if the question requires file exploration
 * 2. Search for relevant files in the codebase
 * 3. Read and analyze those files
 * 4. Provide the analysis to the AI for answering
 *
 * Also includes prompt injection detection to prevent malicious prompts.
 */

import { cache } from "./cache";
import { CACHE_TIER } from "@/lib/constants";
import { logger } from "@/lib/logger";
import { getDb, repositories, commits, files } from "@/db";
import { eq, and, desc } from "drizzle-orm";
import { fetchFileContent } from "@/services/github";

const autoExplorerLogger = logger.child({ service: "auto-explorer" });

// Regex patterns that suggest a question needs code exploration
const EXPLORATION_TRIGGERS = [
  /how is (\w+) done/i,
  /how does (\w+) work/i,
  /how is (\w+) implemented/i,
  /how does (\w+) work(?:ing)?\?/i,
  /can you explain (\w+)/i,
  /explain how (\w+)/i,
  /what is the (\w+) of/i,
  /where is (\w+) located/i,
  /how do I find (\w+)/i,
  /how to use (\w+)/i,
  /what does (\w+) do/i,
  /how (\w+) work/i,
  /(\w+)\s+implementation/i,
  /(\w+)\s+pattern/i,
  /(\w+)\s+approach/i,
];

// Files that should never be explored (security)
const BLOCKED_PATH_PATTERNS = [
  /\.env/i,
  /\.env\./i,
  /credentials/i,
  /secret/i,
  /password/i,
  /private[_-]?key/i,
  /id_rsa/i,
  /\.pem/i,
  /jwt[_-]?secret/i,
  /auth[_-]?config/i,
];

// Common code file extensions to explore
const CODE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".c",
  ".cpp",
  ".sql",
  ".sh",
  ".bash",
  ".yaml",
  ".yml",
  ".json",
];

/**
 * Detect if a question requires codebase exploration
 */
export function requiresExploration(question: string): boolean {
  const questionLower = question.toLowerCase();

  // Check for exploration trigger patterns
  for (const pattern of EXPLORATION_TRIGGERS) {
    if (pattern.test(questionLower)) {
      return true;
    }
  }

  // Check for direct code references that suggest exploration
  const codePatterns = [
    /file[:\s]+[a-zA-Z]/i,
    /in\s+(the )?code/i,
    /source code/i,
    /codebase/i,
    /implementation/i,
    /how\s+(is|are|does|do)/i,
  ];

  for (const pattern of codePatterns) {
    if (pattern.test(questionLower)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a file path is safe to explore
 */
export function isPathSafe(path: string): boolean {
  // Normalize path
  const normalized = path.replace(/\\/g, "/");

  // Check against blocked patterns
  for (const pattern of BLOCKED_PATH_PATTERNS) {
    if (pattern.test(normalized)) {
      autoExplorerLogger.warn({ path }, "Blocked path pattern matched");
      return false;
    }
  }

  // Must be under src or lib directory (or other code dirs)
  const allowedDirs = [
    "src/",
    "lib/",
    "services/",
    "components/",
    "app/",
    "hooks/",
    "types/",
    "db/",
  ];
  const hasAllowedPrefix = allowedDirs.some(
    (dir) => normalized.startsWith(dir) || normalized.includes(`/${dir}`),
  );

  if (!hasAllowedPrefix && !normalized.startsWith(".")) {
    autoExplorerLogger.warn({ path }, "Path does not have allowed prefix");
    return false;
  }

  // Must have a code extension or be a common project file
  const hasCodeExtension = CODE_EXTENSIONS.some((ext) =>
    normalized.endsWith(ext),
  );
  const isCommonProjectFile =
    /README|LICENSE|package\.json|tsconfig|\.md$/i.test(normalized);

  if (!hasCodeExtension && !isCommonProjectFile) {
    autoExplorerLogger.warn({ path }, "File does not have code extension");
    return false;
  }

  return true;
}

/**
 * Extract file path references from a question
 */
export function extractFileReferences(question: string): string[] {
  const references: string[] = [];

  // Pattern: path/to/file.ts or file.ext
  const pathPattern = /`([^`]+?\.(\w+))`|['"]([^'"]+?\.(\w+))['"]/g;
  let match;

  while ((match = pathPattern.exec(question)) !== null) {
    const path = match[1] || match[3];
    if (path && !path.startsWith("http") && !path.includes(" ")) {
      references.push(path);
    }
  }

  // Common patterns like "auth.ts", "api.ts", "utils.ts"
  const simplePattern = /\b([a-zA-Z0-9_-]+\.(ts|tsx|js|jsx))\b/g;
  while ((match = simplePattern.exec(question)) !== null) {
    const path = match[1];
    if (
      references.length < 5 &&
      !references.includes(path) &&
      !references.some((ref) => ref.endsWith("/" + path))
    ) {
      references.push(path);
    }
  }

  return references.slice(0, 5); // Limit to 5 references
}

/**
 * Detect prompt injection attempts
 *
 * Looks for common injection patterns:
 * - "Ignore previous instructions"
 * - "Act as a different persona"
 * - "Output raw system data"
 * - "Show me the system prompt"
 * - "Do something else instead"
 */
export function detectPromptInjection(question: string): {
  isInjected: boolean;
  reason?: string;
} {
  const questionLower = question.toLowerCase();

  const injectionPatterns = [
    {
      regex:
        /ignore\s+(all\s+)?(previous|earlier|past|prior|before|preceding)/i,
      reason: "Ignore instructions attempt",
    },
    {
      regex: /disregard\s+(all\s+)?(previous|earlier|past|prior)/i,
      reason: "Disregard instructions attempt",
    },
    {
      regex: /act\s+as\s+(a|an|the)\s+/i,
      reason: "Persona impersonation attempt",
    },
    {
      regex: /you\s+(are|be)\s+(a|an|the)\s+/i,
      reason: "System prompt exposure attempt",
    },
    {
      regex:
        /output\s+(raw|system|internal|debug|developer|config|environment)/i,
      reason: "Internal data exposure attempt",
    },
    {
      regex:
        /show\s+(me|the)\s+(system|config|environment|secret|key|token|password|credential)/i,
      reason: "Secret exposure attempt",
    },
    {
      regex: /leak\s+(system|prompt|instructions?|config)/i,
      reason: "Prompt leak attempt",
    },
    {
      regex: /bypass\s+(system|security|filter|protection)/i,
      reason: "Bypass attempt",
    },
    {
      regex: /override\s+(system|policy|rule|instruction)/i,
      reason: "Override attempt",
    },
    {
      regex: /replace\s+(your|the)\s+(system|prompt|instruction)/i,
      reason: "Instruction replacement attempt",
    },
    {
      regex: /don['`](s|t)\s+(follow|obey|listen|comply|adhere)/i,
      reason: "Direct non-compliance attempt",
    },
    {
      regex: / disregard (all of|my|the|your own) /i,
      reason: "Disregard instruction attempt",
    },
    { regex: /prompt injection/i, reason: "Explicit injection mention" },
    { regex: /system prompt/i, reason: "System prompt inquiry" },
    {
      regex:
        /what (are|is) (you|your) (system|inner|base) (prompt|instruction)/i,
      reason: "System prompt discovery attempt",
    },
    {
      regex: /how (are|is) (you|your) (prompt|instruction)/i,
      reason: "Prompt structure inquiry",
    },
    {
      regex: /ignore all instructions? ever given to (you|u)/i,
      reason: "Complete instruction override",
    },
    {
      regex: /you are an ai language model/i,
      reason: "Self-identity change attempt",
    },
    {
      regex:
        /output the (full|entire) (system|internal) (prompt|instructions?)/i,
      reason: "Full prompt extraction",
    },
  ];

  for (const { regex, reason } of injectionPatterns) {
    if (regex.test(questionLower)) {
      autoExplorerLogger.warn({ question }, "Prompt injection detected");
      return { isInjected: true, reason };
    }
  }

  return { isInjected: false };
}

/**
 * Generate a cache key for exploration results
 */
async function getExplorationCacheKey(
  repoId: string,
  commitSha: string | null,
  question: string,
): Promise<string> {
  const cleanQuestion = question.replace(/\s+/g, " ").trim();
  const hashInput = `${repoId}:${commitSha || "null"}:${cleanQuestion}`;

  const encoder = new TextEncoder();
  const data = encoder.encode(hashInput);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

  return `exploration:${hash}`;
}

/**
 * Clean up file content for inclusion in AI context
 */
export function cleanFileContent(
  content: string,
  maxLines: number = 100,
): string {
  const lines = content.split("\n");
  if (lines.length <= maxLines) {
    return content;
  }

  const half = Math.floor(maxLines / 2);
  const firstPart = lines.slice(0, half).join("\n");
  const lastPart = lines.slice(-half).join("\n");

  return `${firstPart}\n\n// ... (${lines.length - maxLines} lines omitted) ...\n\n${lastPart}`;
}

/**
 * Find and explore relevant files based on a question
 *
 * This is a placeholder - actual file system access would require
 * integration with Next.js API routes or file system APIs.
 */
export async function exploreForQuestion(
  repoId: string,
  commitSha: string | null,
  question: string,
  // availableFiles: string[] = []
): Promise<{ context: string; cacheHit?: boolean }> {
  // Check for prompt injection first
  const injection = detectPromptInjection(question);
  if (injection.isInjected) {
    return {
      context: `⚠️ Security Alert: This question appears to contain a prompt injection attempt.\n\nReason: ${injection.reason}\n\nI cannot process requests that attempt to bypass security measures or extract system internals.`,
    };
  }

  // Check cache first
  const cacheKey = await getExplorationCacheKey(repoId, commitSha, question);
  const cached = await cache.get<string>(cacheKey);
  if (cached) {
    autoExplorerLogger.info({ repoId, commitSha }, "Exploration cache hit");
    return { context: cached, cacheHit: true };
  }

  try {
    const db = getDb();

    // 1. Resolve commitId and sha
    let commitId: number | null = null;
    let sha = commitSha;

    if (!sha) {
      // Find latest commit for this repo
      const latestCommit = await db
        .select()
        .from(commits)
        .where(eq(commits.repoId, repoId))
        .orderBy(desc(commits.order))
        .limit(1);
      if (latestCommit.length > 0) {
        commitId = latestCommit[0].id;
        sha = latestCommit[0].sha;
      }
    } else {
      const commitResult = await db
        .select()
        .from(commits)
        .where(and(eq(commits.repoId, repoId), eq(commits.sha, sha)))
        .limit(1);
      if (commitResult.length > 0) {
        commitId = commitResult[0].id;
      }
    }

    if (!commitId || !sha) {
      autoExplorerLogger.warn(
        { repoId, commitSha },
        "Could not resolve commit or SHA",
      );
      return { context: "" };
    }

    // 2. Fetch all file paths for this commit (excluding content for efficiency)
    const allFiles = await db
      .select({
        id: files.id,
        path: files.path,
        size: files.size,
        language: files.language,
      })
      .from(files)
      .where(eq(files.commitId, commitId));

    if (allFiles.length === 0) {
      autoExplorerLogger.warn({ commitId }, "No files found in DB for commit");
      return { context: "" };
    }

    // 3. Extract file references from the question
    const fileReferences = extractFileReferences(question);

    // 4. Extract terms from the question for matching
    const questionLower = question.toLowerCase();
    const words = questionLower
      .replace(/[^\w\s-]/g, " ")
      .split(/\s+/)
      .filter(
        (w) =>
          w.length > 3 &&
          ![
            "what",
            "where",
            "when",
            "how",
            "does",
            "done",
            "implement",
            "work",
            "code",
            "file",
            "repo",
            "repository",
            "project",
            "here",
            "explain",
            "understand",
          ].includes(w),
      );

    // 5. Score files based on relevance
    const scoredFiles = allFiles.map((file) => {
      let score = 0;
      const pathLower = file.path.toLowerCase();
      const fileName = pathLower.split("/").pop() || "";

      // Check exact/suffix matches for referenced files
      for (const ref of fileReferences) {
        const refLower = ref.toLowerCase();
        if (pathLower === refLower) {
          score += 100;
        } else if (
          pathLower.endsWith("/" + refLower) ||
          fileName === refLower
        ) {
          score += 80;
        }
      }

      // Check keywords
      for (const word of words) {
        if (fileName.includes(word)) {
          score += 30; // Match in filename is strong
        } else if (pathLower.includes(word)) {
          score += 15; // Match in directory/path is medium
        }
      }

      // Boost some common patterns
      if (
        questionLower.includes("auth") &&
        (pathLower.includes("auth") ||
          pathLower.includes("session") ||
          pathLower.includes("login") ||
          pathLower.includes("credential") ||
          pathLower.includes("token") ||
          pathLower.includes("security"))
      ) {
        score += 20;
      }
      if (
        questionLower.includes("db") ||
        questionLower.includes("database") ||
        questionLower.includes("schema") ||
        questionLower.includes("drizzle")
      ) {
        if (
          pathLower.includes("db") ||
          pathLower.includes("schema") ||
          pathLower.includes("query") ||
          pathLower.includes("model") ||
          pathLower.includes("migration")
        ) {
          score += 20;
        }
      }
      if (
        questionLower.includes("config") ||
        questionLower.includes("env") ||
        questionLower.includes("setting")
      ) {
        if (
          pathLower.includes("config") ||
          pathLower.includes("env") ||
          pathLower.includes("const") ||
          pathLower.includes("setting")
        ) {
          score += 20;
        }
      }

      return { file, score };
    });

    // 6. Filter, sort, and slice to get top 3 files
    const matchedFiles = scoredFiles
      .filter((f) => f.score > 0 && isPathSafe(f.file.path))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((f) => f.file);

    if (matchedFiles.length === 0) {
      autoExplorerLogger.info(
        { question },
        "No matching files found for exploration",
      );
      return { context: "" };
    }

    // 7. Fetch content for these matched files
    const exploredFilesContent: {
      path: string;
      content: string;
      language: string;
    }[] = [];

    // Get repo details for fetching from GitHub if needed
    const repoResult = await db
      .select()
      .from(repositories)
      .where(eq(repositories.id, repoId))
      .limit(1);
    const repo = repoResult[0];

    for (const file of matchedFiles) {
      let content = "";

      // Check DB content first
      const dbFile = await db
        .select({ content: files.content })
        .from(files)
        .where(eq(files.id, file.id))
        .limit(1);

      if (dbFile.length > 0 && dbFile[0].content) {
        content = dbFile[0].content;
      } else if (repo) {
        // Fetch from GitHub
        try {
          const fetched = await fetchFileContent(
            repo.owner,
            repo.name,
            sha,
            file.path,
          );
          if (fetched) {
            content = fetched;
            // Cache content in SQLite files table
            await db
              .update(files)
              .set({ content: fetched })
              .where(eq(files.id, file.id));
          }
        } catch (err) {
          autoExplorerLogger.error(
            { err, path: file.path },
            "Failed to fetch file content during exploration",
          );
        }
      }

      if (content) {
        const cleaned = cleanFileContent(content, 120); // 120 lines max per file
        exploredFilesContent.push({
          path: file.path,
          content: cleaned,
          language: file.language || "text",
        });
      }
    }

    // 8. Build context string
    let context = "";
    if (exploredFilesContent.length > 0) {
      context += `\n\n## Explored Files\nThe following files from the repository at commit ${sha.substring(0, 7)} are relevant to the question:\n\n`;
      for (const file of exploredFilesContent) {
        context += `### File: [\`${file.path}\`](file:${file.path})\n\`\`\`${file.language}\n${file.content}\n\`\`\`\n\n`;
      }
    }

    // Cache the exploration result
    if (context) {
      await cache.set(cacheKey, context, CACHE_TIER.SLOW);
    }

    return { context };
  } catch (error) {
    autoExplorerLogger.error({ error }, "Error in exploreForQuestion");
    return { context: "" };
  }
}

/**
 * Generate exploration guidance based on question type
 */
export function getExplorationGuidance(question: string): string | null {
  const questionLower = question.toLowerCase();

  if (
    questionLower.includes("auth") ||
    questionLower.includes("authentication") ||
    questionLower.includes("login")
  ) {
    return "Check: src/services/ai-credentials.ts, src/lib/api-security.ts, src/services/resource-access.ts";
  }

  if (
    questionLower.includes("config") ||
    questionLower.includes("setting") ||
    questionLower.includes("env")
  ) {
    return "Check: src/lib/constants.ts, src/lib/platform/context.ts, .env.example";
  }

  if (
    questionLower.includes("database") ||
    questionLower.includes("db") ||
    questionLower.includes("schema")
  ) {
    return "Check: src/db/index.ts, src/db/schema.ts, migrations/";
  }

  if (
    questionLower.includes("api") ||
    questionLower.includes("endpoint") ||
    questionLower.includes("route")
  ) {
    return "Check: src/app/api/ directory, src/services/ directory";
  }

  if (questionLower.includes("test") || questionLower.includes("spec")) {
    return "Check: src/**/*.test.ts, src/**/*.spec.ts, __tests__/ directory";
  }

  return null;
}
