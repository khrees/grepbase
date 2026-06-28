# Grepbase Project Guidelines

## React Patterns

### Hooks Usage

**Do NOT use `useEffect`** for derived state or side effects that can be handled declaratively.

- State initialization should use lazy initializers in `useState`, not `useEffect`
- Derived values should use `useMemo`, not `useEffect` + state
- Prefer event handlers over effects for user-triggered changes

If you think you need `useEffect`, consider:
1. Can this be computed during render?
2. Can this be handled in an event handler?
3. Is this truly a side effect that requires synchronization?

## Auto-Exploration for Codebase Questions

When answering "how is X done?" style questions, the system now has **auto-exploration capability**:

### Question Detection

The system detects questions that require code exploration based on patterns like:
- "How is auth done?" / "How does X work?"
- "Can you explain [feature]?"
- "How does [component] work?"
- Questions about architecture, patterns, implementation

### File Discovery

When exploration is needed, the system:
1. **Checks the visible files** in the current commit context
2. **Applies exploration guidance** - maps question keywords to common file locations (e.g., "auth" → `src/services/ai-credentials.ts`, `src/lib/api-security.ts`)
3. **Provides file guidance** to the AI so it knows where to look

### Security: Prompt Injection Protection

All question routes include **prompt injection detection** that blocks:
- "Ignore previous instructions" attempts
- "Act as a different persona" attempts
- "Output raw system data" requests
- "Show me the system prompt" requests
- "Do something else instead" attempts

The detection runs at both the API and service layer for defense in depth.

### Available Tools for File Access

To explore files beyond visible context, use:
- `LSP` - Go to definition, find references, get hover info
- `Bash` - Run `find`/`grep` to locate files
- `Read` - Read file contents once you know the path
