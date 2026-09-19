# Skill Gap Analysis (v1) - Design

## Purpose

Extend the job search agent with inferential skill matching: instead
of only comparing explicitly stated resume skills against a job
posting, infer additional skills the user likely has from their course
names/syllabi, match those (and explicit skills) against a specific
job's requirements, and produce a prioritized learning order for what's
missing.

This is a scoped-down v1 of a much larger idea (see "Cut from v1"
below), reduced after a feasibility review found that several parts of
the original design require a job-posting corpus far larger than this
project's on-demand, no-persistence, free-tier-API architecture can
realistically accumulate - a data-volume problem, not an
implementation-quality one. v1 keeps everything that works per-request
with no accumulated corpus; the rest is explicitly deferred.

## Non-goals (v1)

- No aggregate stats ("this skill appears in X% of postings"). Requires
  a job-posting corpus large enough for the underlying counts to be
  statistically meaningful, which requires background ingestion
  infrastructure this project doesn't have and isn't building now.
- No embedding-based dynamic skill taxonomy (MST/dendrogram
  clustering). Replaced by a small curated equivalence list - accurate
  and predictable for the skills that will actually appear in demos;
  the automated version needs a validation set and a rule-based
  override layer this project isn't building yet.
- No general auto-derived prerequisite graph across all skills.
  Topological ordering applies only to the curated Type-A baseline
  list, which is a graph the maintainer already fully controls.
- No new job-postings database/corpus. The target job is always one
  specific posting the user already has in front of them (see Scope).
- No OCR, no file storage beyond what the resume-upload feature
  already handles.

## Cut from v1 (explicit v2 candidates, not being built now)

- Aggregate/statistical "X% of postings require this skill" feature.
- Embedding-based (e.g. `text-embedding-3-small`) dynamic taxonomy with
  MST/dendrogram clustering and similarity-threshold cutting.
- Background job-posting ingestion pipeline (needed to make the above
  two features statistically meaningful).
- Embedding versioning/re-index strategy (moot without stored
  embeddings).

## Scope (v1)

- Entry point: an "Analyze skill gap" button on each job card in the
  existing search results (`JobCard.tsx`). The target job is that
  specific posting's real title/description - not a job category or
  a freeform search. The resume is whatever the user already submitted
  for that search; no new resume input for this feature.
- Skill inference with three confidence tiers: **High** (explicit
  resume/project/work experience), **Medium** (technology explicitly
  named in a syllabus/course outline), **Low** (guessed from a course
  title alone, e.g. inferring "computer vision" familiarity from a
  course titled "CS 4501: Special Topics"). Low-confidence entries are
  flagged in the UI as "inferred - needs confirmation," never presented
  as fact.
- Two skill types, handled by separate rules:
  - **Type A (evergreen core skills)** - DS&A, system design, testing,
    git, database fundamentals, etc. Fixed, manually maintained
    baseline list. Never "discovered" from a course title: a Type-A
    entry can only be High or Medium confidence (explicit resume/
    project/work or explicit syllabus mention) - Low confidence is
    invalid for this type and rejected at the schema level. If a
    baseline skill has no High/Medium evidence, it's a gap candidate.
  - **Type B (contextual/trending skills)** - specific frameworks,
    cloud services, tools. Freely inferred at any confidence tier.
    Matched against job requirements via a curated equivalence list
    (~50-100 common skills) rather than embeddings, so e.g. a user who
    knows Vue can satisfy a job requirement phrased as "SSR frontend
    framework experience" or "Next.js," without a React/React Native
    style false-positive risk that an embedding-only approach has.
- Gap prioritization: Type-A gaps are ordered via topological sort over
  a curated prerequisite DAG (Type-A skills only). Type-B gaps are
  listed flat, tagged required vs. preferred per the job posting's own
  language, with no cross-JD weighting.

## Architecture

**New route:** `app/api/skill-gap/route.ts` - POST, SSE-streamed
(same pattern as `app/api/agent/route.ts`), behind the same session-
auth and rate-limit checks. Request body: `{ resume: string, job: Job
}`, where `job` is the specific job card's already-known data
(title, company, description, url) - no new job search or fetch
happens in this route.

**New module:** `lib/skills/`, isolated from `lib/tools/` and
`lib/agent/` (different persistence/lifecycle needs - this is the
only part of the app that reads a database):

- `loop.ts` - orchestrates the two-step pipeline for this feature.
  Not built as an autonomous multi-turn tool-use loop like
  `lib/agent/loop.ts`: the sequence here never branches (extract
  resume, then extract the JD, then compute), so there's no actual
  decision for an LLM to make about what to call next. Building a
  decision-loop shape around a fixed sequence would be a false
  abstraction. Instead, this is two sequential Claude calls, each
  forced to a single structured-output tool via `tool_choice`, with
  deterministic code running between and after them.
- `tools.ts`, `systemPrompt.ts` - the two forced-tool definitions and
  prompts: "extract resume skills" and "extract job requirements."
- `schema.ts` - zod schemas for both extraction outputs. Enforces the
  Type-A confidence constraint (no `Low` tier, no names outside the
  baseline list) at validation time, not just via prompting.
- `matchSkills.ts` - pure, deterministic: resolves job requirements
  against the user's inferred skills via the equivalence tables and
  Type-A presence results. Returns matched skills (with which user
  skill covered it and at what confidence - Medium/Low matches are
  flagged "partially confirmed, verify") and a gap list split by type.
- `topoSort.ts` - pure, deterministic: topological sort (Kahn's
  algorithm) over the Type-A gap subgraph plus its prerequisite chain,
  using the DAG edges from the database.
- `db.ts` - thin, read-only query layer over the four curated tables
  (below). No writes at request time.
- `data/seed.ts` - the curated content itself (Type-A baseline skills,
  equivalence groups/members, DAG edges) as checked-in TypeScript, the
  single source of truth. A one-off idempotent seed script loads/
  upserts this into Postgres; edits to the curated lists are made here
  and reviewed as a normal PR diff, never via ad-hoc SQL.

**Database:** Neon (Vercel Postgres), accessed via
`@neondatabase/serverless` (HTTP driver - no connection pooling
concerns on Vercel serverless functions) and Drizzle ORM/`drizzle-kit`
for schema and migrations. This is the first database in the project;
everything else remains stateless per the parent design doc.

## Data model

- **`type_a_skills`** `(id, name, description)` - the curated baseline
  (roughly 15-30 rows).
- **`type_a_dependencies`** `(skill_id, depends_on_id)` - DAG edges,
  Type-A skills only (e.g. "distributed systems" depends on
  "networking fundamentals").
- **`skill_equivalence_groups`** `(id, canonical_name)` - one row per
  concept (e.g. "SSR frontend framework").
- **`skill_equivalence_members`** `(group_id, skill_name)` - concrete
  technologies belonging to that concept (e.g. Next.js, Nuxt,
  SvelteKit under one group).

All four tables are read-only at request time and small enough to be
read in full per request with no caching layer needed in v1.

## Data flow

1. User runs a normal job search (existing flow, unchanged) and clicks
   "Analyze skill gap" on one job card.
2. Client `POST`s `{ resume, job }` to `/api/skill-gap`.
3. Route checks session auth and rate limit (401/429 on failure, same
   as `/api/agent`), then loads the four curated tables in one batch.
4. **Claude call 1 (forced tool, "extract_resume_skills"):** given the
   resume text and the Type-A baseline names as context, returns
   `{ skill, type: "A" | "B", confidence: "High" | "Medium" | "Low",
   evidence }[]`. Schema rejects any `type: "A"` entry with
   `confidence: "Low"`, and rejects any `type: "A"` entry whose name
   isn't in the baseline list.
5. **Claude call 2 (forced tool, "extract_job_requirements"):** given
   the target job's title + description, returns
   `{ skill, importance: "required" | "preferred" }[]`.
6. **`matchSkills`:** for each required/preferred job skill, resolves
   equivalence via `skill_equivalence_members` and checks Type-A
   presence from step 4's results. Produces matched skills and a gap
   list split into Type-A and Type-B.
7. **`topoSort`:** orders the Type-A gap subgraph (plus prerequisite
   chain) via the DAG edges. Type-B gaps stay flat, sorted
   required-before-preferred.
8. Result streams back as SSE progress events ("reading resume...",
   "reading job requirements...", "computing gaps...") followed by a
   final structured result: matched skills, ordered Type-A gaps, flat
   Type-B gaps.
9. `SkillGapPanel.tsx` (new, rendered inside `JobCard.tsx`) shows three
   groupings: **Skills you have** (grouped by confidence tier, Low
   flagged "inferred - needs confirmation"), **Learn these first**
   (numbered Type-A gaps in topo order), **Also missing** (flat
   Type-B gaps, required/preferred badge).

`SearchForm.tsx` and `ResultsPanel.tsx` need no changes - this is
entirely additive at the card level, with its own local
`idle | loading | result | error` state per card, independent across
cards in the results grid.

## Error handling

- Schema validation failure on either Claude call (malformed output,
  or a rule violation like an invalid Type-A confidence tier) is
  rejected and surfaces as a plain "couldn't analyze this job - try
  again," not a raw error or partial result.
- A job posting with very thin/empty description text (common on some
  sources, e.g. RemoteOK) that yields near-zero extracted requirements
  is detected by result count and shown as "This posting doesn't have
  enough detail to analyze," rather than an empty/confusing gap list.
- Auth/rate-limit failures return the same 401/429 handling already
  used by `/api/agent`.
- Network/fetch failures during the request use the same inline-error
  treatment already established in `ResultsPanel.tsx`.

## Testing

- `matchSkills.ts` and `topoSort.ts`: thorough unit tests with fixture
  data. These are the parts that must be exactly correct (not merely
  "good enough" like an LLM judgment), so they get the most rigorous
  coverage - equivalence resolution across groups, Type-A presence
  matching, cycle-free topo-sort ordering, and edge cases (empty gap
  list, all skills matched, disconnected DAG components).
- Unit tests for both zod schemas' rejection rules (Type-A + Low
  confidence rejected; Type-A name outside the baseline list rejected).
- Unit tests for `db.ts` query functions against a local test database.
- Manual end-to-end pass through the real UI with a real resume and a
  real job posting before considering the work done, per the project's
  standing rule to verify features the way an actual end user would
  trigger them.

## Deployment

- One new environment variable, `DATABASE_URL` (Neon connection
  string), added to `.env.example` and to Vercel's Production
  environment variables.
- `drizzle-kit` migration run once to create the four tables.
- The seed script (idempotent - upserts, safe to re-run whenever
  `data/seed.ts` changes) populates/updates the curated content.
- No other infrastructure changes; existing Upstash rate limiting,
  session auth, and job-source integrations are unaffected.
