# 🦅 Grepbase

**Grepbase** is an AI-powered code exploration and visualization platform that helps developers understand the evolution of a codebase. It transforms complex git histories into an interactive, readable timeline enhanced with AI-generated explanations.

## ✨ Features

- 🕰️ **Interactive Timeline**: Visualize the progression of any GitHub repository through its commit history.
- 🤖 **Multi-Provider AI**: Support for the latest models from **OpenAI (GPT-5.3)**, **Google (Gemini 3.1)**, **Anthropic (Claude 4.6)**, **GLM**, and **Kimi**.
- 📝 **AI Code Explanations**: Get deep technical insights into what changed in a commit and why it matters.
- 📂 **File Exploration**: Dive into specific files and have AI explain their purpose and patterns.
- 🔐 **Privacy First**: API keys are encrypted locally in your browser via AES-GCM and sent directly to your chosen AI provider through our API proxy.

## 🚀 Getting Started

### Prerequisites

- [Bun](https://bun.sh) (Recommended runtime)
- Node.js & NPM

### Setup

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/Khrees2412/grepbase.git
    cd grepbase
    ```

2.  **Install dependencies**:
    ```bash
    bun install
    ```

3.  **Environment Variables**:
    Create a `.env` file in the root directory:
    ```env
    GITHUB_TOKEN=your_github_personal_access_token
    NEXT_PUBLIC_APP_URL=http://localhost:3000
    ```

4.  **Run Development Server**:
    ```bash
    bun run dev
    ```

5.  **Open Grepbase**:
    Navigate to [http://localhost:3000](http://localhost:3000) and enter a GitHub repository URL to start exploring.

## 🛠️ Tech Stack

- **Framework**: [Next.js](https://nextjs.org) (App Router)
- **AI Integration**: [Vercel AI SDK](https://sdk.vercel.ai)
- **Styling**: Vanilla CSS & [Framer Motion](https://www.framer.com/motion/)
- **Database**: Drizzle ORM
- **Runtime**: [Bun](https://bun.sh)

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

MIT License
