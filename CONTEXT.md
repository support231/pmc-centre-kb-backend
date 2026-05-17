# PMC Centre AI — Project Context

## What this project is
A ChatGPT-style AI chat application for PMC Centre (Paper Machine Clothing).
It has two repos — a Next.js frontend and a Node.js/Express backend.
The backend uses OpenAI (GPT-5.2) with three modes: PMC Expert, General AI, and Live Web.
Backend deploys on Render, frontend deploys on Netlify, and the UI is embedded inside a Wix site via iframe.

## Repos
- **Frontend**: `pmc-centre-ai-dev` — Next.js 15 + React 18 + TypeScript
- **Backend**: `pmc-centre-kb-backend` (THIS repo) — Node.js/Express + OpenAI SDK

## Backend API
- **Base URL**: Set via `NEXT_PUBLIC_PMC_BACKEND_URL` env var in the frontend
- **Endpoint**: `POST /ask`
- **Request**: `FormData` with fields: `question`, `mode` (PMC|GENERAL|LIVE), `lastAnswer`, optional `file`
- **Response**: `{ "answer": "...", "tokenUsage": {...}, "model": "...", "aiMode": "..." }`
- **Required env var (backend)**: `OPENAI_API_KEY`

## Modes
| Mode | System Prompt | Features |
|------|--------------|----------|
| PMC | Senior PMC technical consultant | File upload, context-aware |
| GENERAL | General AI assistant | File upload, general knowledge |
| LIVE | Live web information | Web search tool, no file upload |

## Current status
- Backend: Functional (`server.js` + `upload.js`), needs deploy to Render
- Frontend: Functional chat UI (`app/page.tsx`), needs `NEXT_PUBLIC_PMC_BACKEND_URL` env var
- Knowledge Base: `KB/` folder with Dryer, Felt, Forming, Reference_Books subdirectories

## Developer notes
- I am a frontend developer with beginner React knowledge
- The frontend communicates with the parent Wix page via `postMessage`