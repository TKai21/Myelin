# Job Search Agent - Design

## Purpose

A portfolio project to demonstrate agentic application design in a job
interview at a company building agent-based job-search products. It
must be a live, public, working demo: an LLM agent that searches real
job APIs, ranks results against the user's resume, and explains its
reasoning - built with production-conscious guardrails (cost, abuse,
error handling), not just a happy-path script.

Not a goal: this is not intended as the user's daily job-search driver.
Feature scope is set by what best demonstrates agent architecture, not
by maximizing personal utility.

## Non-goals

- No LinkedIn scraping or automation of any kind (ToS risk, account-ban
  risk). Job data comes exclusively from APIs that permit programmatic
  access.
- No scheduled/background runs. Search is on-demand only, triggered by
  a user action in the UI.
- No persistence layer / database. Every search is a stateless
  request-response; nothing is saved server-side between runs.
- No file upload / resume parsing (PDF/docx). Resume is pasted as
  plain text.
- No user accounts. Access is gated by a single shared password, not
  per-user auth.

## Architecture

Single Next.js (App Router, TypeScript) application, deployed to
Vercel. No separate backend service, no database. All secrets
(Anthropic API key, Adzuna app id/key, site password) are server-only
environment variables, read exclusively inside API route handlers and
never exposed to client code.

Model: Claude Sonnet, used as the sole LLM in the system. It drives
the entire tool-use loop - deciding which job sources and queries to
call, and later scoring/ranking results against the resume. Job data
normalization (turning each API's JSON response into a common shape)
is deterministic TypeScript, not an LLM step, since the three source
schemas are well-known and require no fuzzy extraction.

## Components

- `app/page.tsx` - password gate (if not yet authenticated) + main UI:
  resume textarea, search criteria form (job title/keywords, location,
  remote-only toggle), and a results panel that renders streamed
  progress and the final ranked list.
- `app/api/auth/route.ts` - accepts a submitted password, compares
  against `SITE_PASSWORD`, and on match sets an httpOnly, signed
  session cookie via a standard cookie-session library (e.g.
  `iron-session`), keyed off a `SESSION_SECRET` env var. No password
  storage beyond the env var, no session store beyond the cookie
  itself.
- `app/api/agent/route.ts` - the core endpoint. Requires the session
  cookie; applies per-IP rate limiting; runs the Claude tool-use loop;
  streams progress events and the final structured result back to the
  client.
- `lib/agent/` - system prompt, tool-use loop orchestration (turn
  cap, tool dispatch), and the ranking output schema/parser.
- `lib/tools/`
  - `searchAdzuna.ts`, `searchRemoteOK.ts`, `searchRemotive.ts` - each
    wraps one real HTTP call and returns a normalized
    `{title, company, location, url, description}[]`, swallowing
    per-source failures into a "source unavailable" result rather than
    throwing.
- `lib/rateLimit.ts` - per-IP request counter (in-memory is acceptable
  for a single-instance demo deployment; document Vercel KV as the
  upgrade path if this ever needs to survive across instances).

## Data flow

1. User authenticates once via the password gate (session cookie set).
2. User pastes resume text and fills search criteria, submits.
3. Client POSTs to `/api/agent`.
4. Route handler checks session cookie and rate limit; rejects with
   401/429 on failure.
5. Claude (Sonnet), given the criteria and tool definitions, decides
   which source(s)/queries to call.
6. Our code executes the real HTTP calls and normalizes results in
   plain TypeScript (no LLM involved in this step).
7. Results are returned to Claude, which de-duplicates listings,
   scores each against the resume, and produces structured output:
   `{score, reasoning}` per job.
8. The response streams back to the client so the UI can show live
   progress ("searching Adzuna...", "ranking 23 results...") before
   rendering the final ranked list as cards.

## Cost & token controls

- Hard `max_tokens` cap on every Claude API call.
- Raw results truncated (e.g. top ~10 per source) before being passed
  to Claude, bounding input tokens regardless of how many listings a
  source API returns.
- Tool-use loop capped at a fixed maximum number of turns (e.g. 6) to
  prevent runaway back-and-forth.
- A hard spending limit (e.g. $5/month) set directly on the Anthropic
  Console, as an account-level backstop independent of app code.

## Abuse protection

- Shared password gate (see Components) as the primary control -
  stops anyone without the password from reaching the agent endpoint
  at all.
- Per-IP rate limiting on `/api/agent` as a second layer, in case the
  password is shared more widely than intended (e.g. the interviewer
  passes it along).

## Error handling

- Each tool call is isolated: a timeout/4xx/5xx from one job source
  does not fail the run. Claude is told that source is unavailable
  and proceeds with whatever sources succeeded.
- Claude API errors (rate limit, timeout, malformed response) surface
  as a clear inline error in the UI, not a crash or blank state.
- Auth/rate-limit failures return proper 401/429 responses with a
  plain-language message, not a generic 500.

## Testing

- Unit tests for each `lib/tools/*` function against mocked HTTP
  responses, covering both successful normalization and
  failure-swallowing behavior.
- Unit test for the ranking-output parser/schema validation (rejects
  malformed model output rather than silently rendering garbage).
- Manual end-to-end pass through the real UI (real API calls, real
  Claude call) before considering the work done - per the project's
  standing rule to verify bug fixes and features the way an actual end
  user would trigger them.

## Deployment

- Vercel, single project, Next.js auto-detected.
- `app/api/agent/route.ts` given an explicit `maxDuration` and the
  response is streamed rather than returned as one blocking payload -
  both a UX improvement (visible progress) and a mitigation against
  Vercel's serverless request-duration ceiling.
- Environment variables configured in Vercel project settings:
  `ANTHROPIC_API_KEY`, `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`,
  `SITE_PASSWORD`, plus a session-signing secret. `.env.example`
  documents all required variables without real values; `.env.local`
  is git-ignored.
