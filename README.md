# Code Review Assistant ✦

AI-powered code review tool — paste your code and receive **3 actionable improvements** plus **1 positive note**, powered by Google Gemini.

## Features

- **Smart Reviews**: Uses Gemini 2.0 Flash for intelligent code analysis
- **7 Languages**: JavaScript, TypeScript, React/JSX, Python, CSS, HTML, SQL
- **Before/After Code**: Each suggestion includes concrete code examples
- **Review History**: Past reviews saved locally (up to 20)
- **Copy as Markdown**: One-click copy of the full review
- **Secure**: API key stays server-side, never exposed to the browser
- **Abuse Protection**: Rate limiting (10/min, 50/day per IP) + prompt injection detection

## Quick Start

### 1. Get a Gemini API Key
Visit [aistudio.google.com/apikey](https://aistudio.google.com/apikey) and create a free API key.

### 2. Configure
Create a `.env.local` file in the project root:
```
GEMINI_API_KEY=your_actual_api_key_here
```

### 3. Install Vercel CLI
```bash
npm i -g vercel
```

### 4. Run Locally
```bash
vercel dev
```
Open [http://localhost:3000](http://localhost:3000)

## Deploy to Vercel

1. Push your code to GitHub
2. Import the repo on [vercel.com](https://vercel.com)
3. Add `GEMINI_API_KEY` in **Settings → Environment Variables**
4. Deploy!

Or via CLI:
```bash
vercel --prod
```

## Project Structure

```
coding-buddy/
├── api/
│   └── review.js              # Serverless function (Gemini proxy)
├── lib/
│   ├── rate-limiter.js        # IP-based rate limiting
│   ├── input-validator.js     # Prompt injection + code validation
│   └── gemini-client.js       # Gemini API client
├── public/
│   ├── index.html             # Single page
│   ├── style.css              # Dark glassmorphism theme
│   └── app.js                 # Frontend logic (CodeMirror, history)
├── vercel.json                # Vercel config
├── package.json
└── .env.local                 # API key (gitignored)
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | HTML + CSS + Vanilla JS |
| Editor | CodeMirror 6 (via CDN) |
| Highlighting | Prism.js (via CDN) |
| Backend | Vercel Serverless Functions |
| AI | Google Gemini 2.0 Flash |
| Fonts | Inter + JetBrains Mono |

## License

MIT
