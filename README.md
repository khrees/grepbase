# Grepbase

A code search and analysis platform powered by AI.

## Features

- Fast code search across repositories
- AI-powered code analysis and insights
- GitHub integration
- Cloudflare-native architecture (D1, KV, R2)

## Tech Stack

- **Frontend**: Next.js (static export)
- **Backend**: Hono API on Cloudflare Workers
- **Database**: Cloudflare D1
- **Storage**: Cloudflare KV + R2
- **Runtime**: Bun

## Quick Start

```bash
# Install dependencies
bun install

# Set up environment variables
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local

# Start development servers
bun run dev:api    # API on localhost:3001
bun run dev:web    # Web on localhost:3000
```

## Development

### Project Structure

```
apps/
├── web/     # Next.js frontend
└── api/     # Hono backend
```

### Available Commands

```bash
bun run dev:api      # Start API server
bun run dev:web      # Start web app
bun run build        # Build all apps
bun run lint         # Lint codebase
```

### Database Migrations

```bash
bun run db:generate  # Generate migration
bun run db:push      # Apply migration locally

# For production (Cloudflare D1)
cd apps/api
wrangler d1 migrations apply grepbase-db
```

## Deployment

### Frontend (Cloudflare Pages)

```bash
cd apps/web
bun run build
```

Deploy the `apps/web/out` directory to Cloudflare Pages.

### Backend (Cloudflare Workers)

```bash
cd apps/api
wrangler deploy
```

Configure D1/KV/R2 bindings in `wrangler.toml` and set secrets:

```bash
wrangler secret put GITHUB_TOKEN
```

## License

MIT
