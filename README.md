# Setu — SEBI Compliance Portal

Regulatory text → runtime compliance. SEBI maintains one canonical regulatory graph;
intermediaries register and get a personalised compliance dashboard.

- **Scope spec:** [docs/extraction-and-attribute-resolution-scope.md](docs/extraction-and-attribute-resolution-scope.md)
- **Build plan:** [TASKS.md](TASKS.md)

## Stack
- **postgres** (pgvector) — structured data + embeddings + graph edges
- **mongodb** — raw circulars / clause trees / LLM logs
- **backend** — NestJS (TypeORM, JWT, Swagger) · port 3000
- **ai-service** — Python FastAPI (PDF parse, LLM, embeddings) · port 8000
- **frontend** — Next.js + Tailwind · port 3001
- **pgadmin** — DB browsing · port 5050

## Run (M0)
```bash
cp .env.example .env          # already present for dev
docker compose up --build
```
Then:
- Frontend: http://localhost:3001 (click **Ping backend**)
- Backend health: http://localhost:3000/api/v1/health
- Swagger: http://localhost:3000/api/v1/docs
- AI service health: http://localhost:8000/health
- pgAdmin: http://localhost:5050 (admin@setu.local / admin)

## Layout
```
services/backend/    NestJS API
services/ai-service/ FastAPI intelligence (stateless)
frontend/            Next.js portal (both personas)
shared/types/        shared TS types
infra/docker/        init-db.sql
docs/                specs
```
