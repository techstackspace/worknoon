# Worknoon Refund Support

Worknoon is a small full-stack refund support demo. Customers submit an order and a refund request; the backend evaluates it against deterministic policy rules, asks an optional AI service to classify the request and prepare support text, then records the authoritative decision and audit events. A support view shows the request, policy outcome, AI analysis, and audit history.

## Architecture

```text
React + Vite browser
        │ HTTP (customer and support views)
        ▼
Express API ───────► PostgreSQL via Prisma
   │ validate and load trusted customer/order/item facts
   ▼
Deterministic refund policy ──► authoritative decision
   │ trusted facts + policy result + untrusted customer message
   ▼
Optional OpenAI analysis ─────► classification, summary, acknowledgement
   │ AI recommendation is audit-only
   ▼
Atomic request + decision + audit persistence ──► API response
```

The browser is a client and never submits a decision. The API retrieves customer and order data from PostgreSQL and computes the policy outcome. Customer text remains untrusted, including when passed to the model. The model has no tools or database access, returns schema-validated JSON, and cannot change the policy outcome. The database stores the request, policy result, AI metadata, and audit entries. The browser displays customer messages as React text, not HTML.

## Features

- Customer and order lookup using synthetic demo data.
- Refund form with amount and customer-provided explanation.
- Deterministic evaluation for final sale, refund window, amount threshold, suspicious/conflicting messages, and eligible damaged/incorrect claims.
- Optional AI classification, concise support summary, confidence, non-authoritative recommendation, and acknowledgement text.
- Approved, denied, or escalated response from the policy outcome.
- Support dashboard with recent requests, policy rules/reasons, AI analysis, customer response, and audit events.
- Database-backed health endpoint at `GET /api/health`.

## Run with Docker Compose

Prerequisites: Docker Engine/Desktop with the Compose plugin. To build and launch:

```sh
cp .env.example .env
docker compose up --build
```

Compose starts PostgreSQL and waits for its health check. The API then applies checked-in Prisma migrations, seeds synthetic data, and starts. The frontend container builds the Vite app and serves it through Nginx after the API health check succeeds. Open the customer/support app at [http://localhost:5173](http://localhost:5173); the API health endpoint is [http://localhost:3000/api/health](http://localhost:3000/api/health).

The database uses the named `postgres_data` volume. `docker compose down -v` deletes that local demo database and its data.

**Verification limitation:** Docker is not installed in the development environment used for this submission, so `docker compose up --build`, PostgreSQL startup, actual migration/seed execution, and container-to-container operation have not been verified here. Compose YAML syntax was checked. Run the command above on a Docker-enabled machine for final manual verification.

## Local development

Prerequisites: Node.js 22+, npm, and a reachable PostgreSQL server. The supported root workspace scripts are in `package.json`.

```sh
cp .env.example .env
npm ci
docker compose up -d db
```

Load the root environment file into the shell for Prisma CLI commands, then generate the client, apply migrations, seed, and start both apps:

```sh
set -a
. ./.env
set +a
npm run db:generate
npm run db:deploy -w @worknoon/api
npm run db:seed -w @worknoon/api
npm run dev
```

The API is on port `3000`, and Vite is on port `5173`. The API and Vite load the root `.env` during local development; `VITE_API_URL` is the browser-visible API base URL. To run just one workspace, use `npm run dev -w @worknoon/api` or `npm run dev -w @worknoon/web`. The API build emits `apps/api/dist/src/index.js`, which is the configured production entry point.

## Environment variables

Copy `.env.example` to `.env`. The sample database password is a local placeholder only.

| Variable | Consumer | Meaning |
| --- | --- | --- |
| `POSTGRES_USER` | Compose/PostgreSQL | Local database user |
| `POSTGRES_PASSWORD` | Compose/PostgreSQL | Local database password; use a proper secret outside local development |
| `POSTGRES_DB` | Compose/PostgreSQL | Local database name |
| `DATABASE_URL` | API/Prisma | PostgreSQL connection URL; Compose sets its internal host to `db` |
| `API_PORT` | API | HTTP listen port, default `3000` |
| `WEB_ORIGIN` | API | Allowed browser origin for CORS, default `http://localhost:5173` |
| `OPENAI_API_KEY` | API only | Optional server-side model credential; blank disables live AI |
| `OPENAI_MODEL` | API only | Model name, default `gpt-4o-mini` |
| `VITE_API_URL` | Web build | Public API URL, default `http://localhost:3000`; never put secrets here |

The OpenAI credential is passed only to the API process and is not exposed to the web bundle. No real API keys are included in this repository. No live OpenAI request was made during the recorded test run.

## Database and seed data

Prisma models `Customer`, `Order`, `OrderItem`, `RefundRequest`, `RefundDecision`, and `AuditLog` use PostgreSQL relations, foreign keys, unique constraints, timestamps, and indexes. The initial schema is checked in as a migration under `apps/api/prisma/migrations/`. `npm run db:deploy -w @worknoon/api` applies migrations; `npm run db:seed -w @worknoon/api` creates/upserts 15 fictional customers, 16 orders, and 8 sample refund requests.

The seeded requests demonstrate eligible damaged and incorrect items, final-sale denial, an expired order, an amount over $500, suspicious/conflicting text, and more than one order for one customer. Seed orders use dates relative to their first creation. On a fresh database they reproduce those scenarios; repeated seeding updates decisions based on the current order age.

## Refund policy

The 30-day refund period and $500 review threshold are documented business-rule assumptions for this demo, not claims about a real merchant policy. An order exactly 30 days old is still within the window. Policy precedence is:

1. **DENIED** if an order contains a final-sale item or is older than 30 days.
2. Otherwise **ESCALATED** if the amount is greater than $500, or the message contains detected suspicious/conflicting signals.
3. Otherwise **APPROVED** by this demo's baseline eligibility rule. Damaged and incorrect claims are recorded as eligible claim types; other claims receive a standard eligibility rule.

All matching policy rules/reasons are recorded even when a higher-priority rule determines the decision. Exactly $500 does not trigger the amount escalation. This is a simple assessment policy, not a complete production refund policy.

## Request and decision flow

`POST /api/refunds` follows this order:

1. Validate JSON shape, known fields, customer/order IDs, positive dollar amount (up to two decimal places), and customer message length/control characters.
2. Load the customer, then load an order belonging to that customer and its items from PostgreSQL. Reject missing records and amounts greater than the order total.
3. Run the pure Stage 2 policy module against the trusted purchase date, amount in cents, final-sale state, and customer-message risk signals.
4. Send customer/order/refund facts and the policy result to the AI provider. Customer text is explicitly labeled untrusted.
5. Keep the policy result as the final decision. Add outcome wording from backend code; AI-generated customer text is restricted to acknowledgement language.
6. Persist request, decision, policy/AI metadata, and audit events in a nested Prisma write, then return the result.

The other API endpoints are `GET /api/customers`, `GET /api/customers/:customerId/orders`, `GET /api/refunds`, and `GET /api/refunds/:id`. Dashboard routes are currently unauthenticated, as noted below.

## AI integration and security

The AI adapter is in `apps/api/src/ai/refund-ai-service.ts`; `RefundService` invokes it after deterministic policy evaluation. The model receives selected structured data from the database (customer ID/name, order number/date/currency/total/items), requested amount, customer message, and policy result/rules. It is asked to classify the claim, give confidence and a concise support summary, produce acknowledgement text, and identify uncertainty/signals. Hidden chain-of-thought is neither requested nor stored.

The API requires strict structured JSON and validates fields and bounds at runtime. Missing keys, provider failures, refusals, truncated output, malformed JSON, and schema-invalid output enter the same safe fallback path. The fallback records AI as unavailable while preserving the policy decision and its customer outcome. An AI recommendation is stored only as analysis and cannot directly update the request status.

Customer messages are validated but remain untrusted data; the prompt explicitly says to ignore any embedded instructions. Policy rule detection happens in deterministic code before the AI call, and the service takes the final decision from that policy result. This reduces prompt-injection impact but does not make a language model immune to manipulation: all model fields remain data, the decision stays backend-owned, and production use should monitor and further constrain model text. API keys stay server-side. JSON body size is limited, unknown fields such as client decision values are rejected, error responses avoid provider/database details, and React escapes displayed text by default.

This assessment/demo has no authentication or authorization on support APIs or dashboard. Before shared or production deployment, protect support records with authenticated roles, secure secrets, add operational controls such as rate limits, and review privacy/retention requirements. It also has no idempotency key or duplicate-request prevention.

## Tests and checks

The backend currently has 36 Vitest tests: 13 deterministic policy tests, 17 service tests, and 6 HTTP integration tests. They use mocked Prisma and AI dependencies; the HTTP integration tests exercise a real in-process Express server. Together they cover policy precedence/boundaries, request validation and persistence, API responses, AI failures/invalid output, and prompt-injection cases.

Run:

```sh
npm test
npm run typecheck
npm run build
DATABASE_URL='postgresql://worknoon:local_dev_password@localhost:5432/worknoon?schema=public' npx prisma validate --schema apps/api/prisma/schema.prisma
npm run db:generate
docker compose config
```

For this submission, tests (36), typecheck, production build, Prisma validation/generation, migration SQL comparison, Compose YAML parsing, frontend bundle secret scan, and `git diff --check` passed. Docker/PostgreSQL end-to-end execution and live OpenAI requests were **not** performed in the current environment. The API tests do not substitute for a real database or provider check.
