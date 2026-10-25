# FresherAI

An AI-powered interview preparation platform with resume scoring, mock interviews, and personalized learning roadmaps — built with microservices architecture.

---

## What It Does

FresherAI helps fresh graduates prepare for tech interviews with:

- **Resume Scoring** — AI analyzes your resume and provides a score with improvement suggestions
- **Mock Interviews** — LLM-powered interview sessions with dynamic question generation
- **Learning Roadmaps** — Personalized skill development paths based on your goals
- **Practice Quizzes** — Timed aptitude and CS fundamentals quizzes from a bundled, approved question bank
- **SQL Playground** — Browser-local SQLite exercises with instant result checking and no server-side query execution
- **Coding Arena** — Original JavaScript and Python challenges run in disposable browser workers; optional cached complexity reviews cost 5 interview coins
- **Credit System** — Pay-per-use billing with Razorpay integration

---

## Architecture

```
React + Vite frontend
        ↓
Express API gateway ───── Redis (sessions, limits, cache, resume jobs, event stream)
        ↓
┌───────┼────────┬───────────┬─────────┬──────────┬──────────┐
Auth  Resume  Interview   Roadmap   Billing   Progress   Practice
        └──────────┴───────────┴───────────┘
              MongoDB
        AI services → Groq
```

**Services:**

| Service | Port | Description |
|---------|------|-------------|
| Gateway | 8000 | API routing, auth middleware |
| Auth | 8001 | Firebase login, sessions |
| Resume | 6002 | PDF parsing, AI resume scoring |
| Interview | 6003 | Mock interviews with LangGraph agent |
| Roadmap | 6004 | Personalized learning paths |
| Billing | 6005 | Credit system, Razorpay |
| Progress | 6006 | Redis Stream event consumer, progress and streak aggregates |
| Practice | 6007 | Timed quizzes, SQL and coding problem banks, and practice attempt recording |
| Frontend | 5173 | React + Vite client |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React, Vite |
| Backend | Node.js, Express |
| LLM | Groq (LangChain) |
| Workflow | LangGraph |
| Database | MongoDB (Mongoose) |
| Cache | Redis |
| Auth | Firebase Admin |
| Payments | Razorpay |
| PDF | pdf2json |

---

## Project Structure

```
Fresher-Ai/
├── frontend/               # React + Vite client
├── backend/
│   ├── gateway/            # API gateway
│   ├── shared/             # Shared utilities
│   └── services/
│       ├── auth/           # Firebase authentication
│       ├── resume/         # Resume upload & AI scoring
│       ├── interview/      # Mock interview sessions
│       ├── roadmap/        # Learning roadmap generation
│       ├── progress/       # User activity aggregates and event lag
│       ├── practice/       # Approved aptitude and CS fundamentals questions
│       └── billing/        # Credits & Razorpay
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- MongoDB (local or Atlas)
- Redis
- Firebase project
- API keys: Groq, Razorpay

Practice quizzes, SQL exercises, and coding problems run without LLM keys. SQL and JavaScript/Python solutions execute in disposable browser contexts; Python uses locally bundled Pyodide assets. Coding scores are browser-reported practice stats and can be tampered with, so they never award coins or count toward authoritative leaderboards. Optional AI code review uses the interview LLM cache and costs 5 coins. To draft extra quiz questions manually, set `GROQ_API_KEY` and run `node scripts/generate-questions.js <topic> [count]`; generated questions stay in draft status until explicitly approved. Approve selected IDs with `node scripts/approve-questions.js <id...>` or approve all drafts with `--all`.

### Installation

```bash
git clone https://github.com/DivayJainDJ/Fresher-Ai.git
cd Fresher-Ai

# Install the root workspace dependencies
npm ci
```

### Local Compose

1. Copy `.env.example` to `.env`. The containers can start without third-party credentials; add Firebase credentials for login, Groq credentials for AI features, and Razorpay credentials for payments.
2. Start the complete local stack:

```bash
cp .env.example .env
docker compose up --build
```

Open the frontend at `http://localhost:5173`; the gateway listens at `http://localhost:8000`. Compose starts Redis and MongoDB locally. No monitoring ping is configured, so hosted Render services can sleep while idle.

### CI checks

Run the same checks locally:

```bash
npm ci
npm test
npm run build --workspace frontend
```

GitHub Actions runs these checks and builds the backend images plus the frontend image on pushes and pull requests.

### Progress event bus

Interview completion, resume scoring, and roadmap generation publish best-effort events into Redis Streams. The progress service consumes them with a durable consumer group, records each `eventId` once in MongoDB, updates per-user module totals/streaks/weak topics, and exposes `GET /api/progress/me`. Failed messages retry up to `EVENT_MAX_ATTEMPTS`, then move to `fresherai:events:dead`. The roadmap service consumes the same stream independently and marks matching weak interview topics as practiced.

With Redis, MongoDB, and the progress service running, measure event lag at 100 publishes per second with:

```bash
npm run benchmark:lag --workspace=progress -- --rate=100 --count=1000
```

The command prints average, p50, p95, and maximum publish-to-process lag, then removes its synthetic Mongo records. This benchmark has not been run against a live Redis/Mongo deployment in this workspace.

### Deployment settings

Set `GROQ_MODEL` once in the shared Render environment group. The current model, `qwen/qwen3.8-27b`, is listed in Groq's [official model catalog](https://console.groq.com/docs/models) as a Preview model and has token pricing; check your Groq account's current quota and billing before enabling it. The Render blueprint asks for `FRONTEND_URL`; enter the exact comma-separated origins you control. Do not enter broad preview host patterns.

Configure Razorpay's `payment.captured` webhook at `https://<gateway-host>/api/billing/webhook` and set the matching signing secret as `RAZORPAY_WEBHOOK_SECRET`.

### Credits, provider fallback, and limits

Credit purchases, feature spends, and refunds are recorded in the append-only `CreditLedger` collection. Payment order settlement and the corresponding coin/ledger writes use a MongoDB transaction, so MongoDB must support transactions (Atlas replica sets do; local Compose starts a single-node replica set). Credit costs remain server-owned in `backend/shared/utils/coinCosts.js`.

The gateway supports both the existing Redis fixed-window limiter and an atomic Redis token-bucket middleware. LLM provider/cache/retry/failover counters and provider latency totals are stored in Redis and exposed through the protected `/metrics` endpoint. These counters are operational totals, not a benchmark: cache p95, saved tokens, live provider failover time, and sustained multi-instance 429 behavior still require a representative live workload to measure.

### Results

| Check | Result |
|---|---:|
| Node test cases | 16 passed |
| Frontend production build | Passed |
| Backend image builds | Configured in CI; not run locally |
| Live deployment/demo | Not configured in this change |

A real demo GIF and production link require a running deployed project and captured UI session; this repository copy does not include those assets.

### Resume Scoring
1. User uploads PDF resume
2. Service extracts text with pdf2json
3. Groq LLM analyzes content, structure, and relevance
4. Returns score + detailed feedback

### Mock Interview
1. User selects interview type and difficulty
2. LangGraph agent generates questions dynamically
3. Agent evaluates responses in real-time
4. Provides score and improvement tips after session

### Learning Roadmap
1. User specifies goals and current skills
2. LLM generates a personalized learning path
3. Includes resources, milestones, and timelines

---

## Author

**Divay Jain**
- GitHub: [DivayJainDJ](https://github.com/DivayJainDJ)

---

## License

MIT
