# Grepbase

An AI-powered git history explorer. Paste a GitHub repository, walk every commit, and understand what changed and why — with AI.

## Features

- **Commit Timeline** — Navigate any public GitHub repository commit-by-commit with keyboard shortcuts (← →)
- **Code View** — Browse the file tree and read source at any point in history
- **Diff View** — Inspect what changed in a commit (unified or split) or compare any two commits
- **Story Mode** — AI narrates the arc of a commit in plain English
- **AI Chat** — Ask questions about any commit with full file context
- **Multi-Provider AI** — Works with OpenAI, Anthropic, Gemini, Ollama, LM Studio, GLM, and Kimi
- **BYOK** — API keys are encrypted server-side per session; never stored in the browser

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) (recommended) or Node.js 20+

### Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/Khrees2412/grepbase.git
   cd grepbase
   ```

2. Install dependencies:
   ```bash
   bun install
   ```

3. Create a `.env.local` file:
   ```env
   # Required
   GITHUB_TOKEN=your_github_personal_access_token

   # Required — must be stable across restarts (session credentials become unreadable if changed)
   AI_CREDENTIALS_ENCRYPTION_KEY=generate_a_long_random_secret
   AI_CREDENTIALS_SIGNING_KEY=generate_a_second_long_random_secret

   # Optional — used as fallback when no user key is configured for a session
   OPENAI_API_KEY=
   ANTHROPIC_API_KEY=
   GEMINI_API_KEY=
   GLM_API_KEY=
   KIMI_API_KEY=

   # Optional
   ADMIN_API_KEY=generate_an_admin_secret_for_retry_endpoints
   NEXT_PUBLIC_APP_URL=http://localhost:3000
   ```

4. Start the development server:
   ```bash
   bun run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000) and paste a GitHub repository URL to start exploring.

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js (App Router) |
| Runtime | Bun |
| Database | SQLite via Drizzle ORM |
| Styling | Vanilla CSS Modules |
| Animation | Framer Motion |
| AI | Vercel AI SDK (multi-provider) |

## Usage

1. On the home page, enter any public GitHub repository URL (e.g. `sindresorhus/is`)
2. Grepbase ingests the commit history into a local SQLite database
3. On the Explore page, use ← → to walk commits, or click in the timeline
4. Open Settings (⚙) to add your AI provider key and unlock explanations

## Contributing

Pull requests are welcome. For significant changes, open an issue first to discuss the approach.

## License

MIT
