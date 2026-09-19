# Skill Gap Analysis (v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "skill gap analysis" feature that lets a user click "Analyze skill gap" on any job card, and see which skills they likely have (confidence-tiered), which required skills they're missing, and a prioritized learning order for the missing evergreen (Type-A) skills.

**Architecture:** A new isolated module `lib/skills/` runs two sequential Claude calls (each forced to a single structured-output tool via `tool_choice`) - one extracts confidence-tiered skills from the resume, one extracts required/preferred skills from the target job's posting text - then deterministic TypeScript (`matchSkills.ts`, `topoSort.ts`) resolves equivalence/matches and orders the gaps. A new streamed route `app/api/skill-gap/route.ts` orchestrates this behind the existing session-auth/rate-limit checks. Curated reference data (Type-A baseline skills + prerequisite DAG, Type-B equivalence groups) lives in a new Postgres database (Neon), seeded from a checked-in TypeScript source file.

**Tech Stack:** Next.js App Router/TypeScript (existing), `@anthropic-ai/sdk` (existing), `zod` (existing), `drizzle-orm` + `drizzle-kit` + `@neondatabase/serverless` (new, production DB access), `@electric-sql/pglite` + `drizzle-orm/pglite` (new, dev-dependency only, used to run real Postgres-compatible SQL in tests with no network/service dependency), `vitest` (existing).

**Spec:** `docs/superpowers/specs/2026-09-19-skill-gap-analysis-design.md`

## Global Constraints

- No new job-postings database/corpus - the target job is always the one specific posting already in the client's hands (from `RankedJobWithDescription`, see Task 1). No re-fetching, no category search.
- Type-A skill entries can only have confidence `"High"` or `"Medium"` - `"Low"` is invalid for Type-A and must be rejected at the zod-schema level, not just by prompting.
- A Type-A entry's `skill` name must be one of the DB's curated baseline names - any other name for `type: "A"` is invalid and rejected at the zod-schema level.
- The two-step pipeline (`lib/skills/loop.ts`) is a fixed sequence, not an autonomous multi-turn tool-use loop - do not model it after `lib/agent/loop.ts`'s `tool_choice: { type: "auto" }` branching pattern. Both Claude calls use a forced `tool_choice: { type: "tool", name: "..." }`.
- `lib/skills/` stays isolated from `lib/tools/` and `lib/agent/` except for the one prerequisite fix in Task 1 and reuse of the `Job`/`RankedJob` types where genuinely shared.
- All new API surface (`app/api/skill-gap/route.ts`) must apply the same session-auth and rate-limit checks as `app/api/agent/route.ts`, using the existing `getSession()` / `getRateLimiter()` / `getClientIp()` helpers - no new auth or rate-limit mechanism.
- Match the project's existing code style: no comments beyond non-obvious "why" notes (see existing `lib/agent/*.ts`, `lib/tools/*.ts` for the house style), TDD (failing test → implementation → passing test → commit) for every unit of logic.

---

## Task 1: Thread job description through the ranking pipeline to the client

The spec assumes the client already has each job's `description` text available to send to the new route. It doesn't: `RankedJob` (`lib/agent/schema.ts`) - the type that actually reaches the browser via the `/api/agent` SSE stream - has no `description` field. The raw `Job.description` text exists only transiently inside `runAgentLoop` (from the search tool calls) and is discarded once Claude submits its rankings. This task closes that gap before anything else can be built, by having the loop attach each job's original description (looked up by URL) to the final result it yields.

**Files:**
- Modify: `lib/agent/loop.ts`
- Modify: `lib/agent/loop.test.ts`
- Modify: `components/ResultsPanel.tsx`
- Modify: `components/JobCard.tsx`

**Interfaces:**
- Produces: `RankedJobWithDescription` (exported from `lib/agent/loop.ts`) = `RankedJob & { description: string }`. `AgentEvent`'s `"result"` variant now carries `{ jobs: RankedJobWithDescription[] }` instead of `RankedResults`. This is what Task 13's `SkillGapPanel` will receive as its `job` prop.

- [ ] **Step 1: Write the failing test for description enrichment**

Add to `lib/agent/loop.test.ts`, inside the existing `describe("runAgentLoop", ...)` block:

```typescript
  it("enriches the submitted rankings with the original job description", async () => {
    const client = fakeClient([
      {
        content: [
          {
            type: "tool_use",
            id: "call_1",
            name: "search_adzuna",
            input: { keywords: ["backend"], location: "", remoteOnly: false },
          },
        ],
      } as unknown as Anthropic.Message,
      {
        content: [
          {
            type: "tool_use",
            id: "call_2",
            name: "submit_rankings",
            input: { jobs: [validRankedJob] },
          },
        ],
      } as unknown as Anthropic.Message,
    ]);

    const events = await collect(
      runAgentLoop(client, "resume text", {
        keywords: ["backend"],
        location: "",
        remoteOnly: false,
      })
    );

    const resultEvent = events.find((e) => e.type === "result");
    expect(resultEvent).toMatchObject({
      type: "result",
      data: { jobs: [{ ...validRankedJob, description: "" }] },
    });
  });
```

(The mocked `searchAdzuna` at the top of the file returns a job with `url: "https://example.com/1"` and `description: ""`, matching `validRankedJob.url` - so `""` is the expected enriched value here. This test currently fails only in the sense that it passes today for the wrong reason - it can't distinguish "no description field" from "empty description field". Step 2 makes that distinction meaningful by first asserting a non-empty case.)

Replace that test body's mock with a non-empty description so the assertion actually proves enrichment happened - update the top-of-file mock instead of the test:

```typescript
vi.mock("../tools/searchAdzuna", () => ({
  searchAdzuna: vi.fn().mockResolvedValue({
    source: "adzuna",
    jobs: [
      {
        source: "adzuna",
        title: "Backend Engineer",
        company: "Acme",
        location: "Remote",
        url: "https://example.com/1",
        description: "Build backend services in TypeScript.",
      },
    ],
  }),
}));
```

And update the new test's assertion to match:

```typescript
    expect(resultEvent).toMatchObject({
      type: "result",
      data: {
        jobs: [
          { ...validRankedJob, description: "Build backend services in TypeScript." },
        ],
      },
    });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- lib/agent/loop.test.ts`
Expected: FAIL - the `"enriches the submitted rankings..."` test fails because `resultEvent.data.jobs[0]` has no `description` property yet.

- [ ] **Step 3: Implement description enrichment in the loop**

Edit `lib/agent/loop.ts`:

```typescript
import type Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT } from "./systemPrompt";
import { AGENT_TOOLS } from "./tools";
import { parseRankedResults, type RankedJob, type RankedResults } from "./schema";
import { topByRelevance } from "../relevance";
import { searchAdzuna } from "../tools/searchAdzuna";
import { searchRemoteOK } from "../tools/searchRemoteOK";
import { searchRemotive } from "../tools/searchRemotive";
import type { SearchCriteria, ToolResult } from "../tools/types";

const MODEL = "claude-sonnet-5";
const MAX_TOOL_ROUNDS = 6;
const RESULTS_PER_SOURCE = 10;

export type RankedJobWithDescription = RankedJob & { description: string };

export type AgentEvent =
  | { type: "progress"; message: string }
  | { type: "result"; data: { jobs: RankedJobWithDescription[] } }
  | { type: "error"; message: string };
```

(`RankedResults` import stays - it's still the type `parseRankedResults` returns before enrichment.)

In the tool-dispatch loop, track descriptions as results come back. Change:

```typescript
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const toolUse of toolUses) {
      yield { type: "progress", message: `Calling ${toolUse.name}...` };
      const result = await runTool(
        toolUse.name,
        toolUse.input as Partial<SearchCriteria>,
        criteria
      );
```

to also populate a map right after `const result = ...`:

```typescript
      for (const job of result.jobs) {
        descriptionsByUrl.set(job.url, job.description);
      }
```

Declare `descriptionsByUrl` once, before the `for (let round ...)` loop:

```typescript
  const descriptionsByUrl = new Map<string, string>();
```

Finally, change the `submit` branch to enrich before yielding:

```typescript
    const submit = toolUses.find((t) => t.name === "submit_rankings");
    if (submit) {
      try {
        const parsed: RankedResults = parseRankedResults(submit.input);
        const jobs: RankedJobWithDescription[] = parsed.jobs.map((job) => ({
          ...job,
          description: descriptionsByUrl.get(job.url) ?? "",
        }));
        yield { type: "result", data: { jobs } };
      } catch (err) {
        yield {
          type: "error",
          message:
            "Agent returned malformed rankings: " +
            (err instanceof Error ? err.message : "unknown"),
        };
      }
      return;
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- lib/agent/loop.test.ts`
Expected: PASS (all tests, including the new one)

- [ ] **Step 5: Update downstream client types**

In `components/ResultsPanel.tsx`, change the import and state type:

```typescript
import type { AgentEvent, RankedJobWithDescription } from "@/lib/agent/loop";
```

(remove the now-unused `import type { RankedJob } from "@/lib/agent/schema";` line)

```typescript
  const [jobs, setJobs] = useState<RankedJobWithDescription[] | null>(null);
```

In `components/JobCard.tsx`, change the import and prop type:

```typescript
import type { RankedJobWithDescription } from "@/lib/agent/loop";
```

(remove `import type { RankedJob } from "@/lib/agent/schema";`)

```typescript
const sourceLabels: Record<RankedJobWithDescription["source"], string> = {
  adzuna: "Adzuna",
  remoteok: "RemoteOK",
  remotive: "Remotive",
};

export function JobCard({ job }: { job: RankedJobWithDescription }) {
```

- [ ] **Step 6: Run the full test suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all tests PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add lib/agent/loop.ts lib/agent/loop.test.ts components/ResultsPanel.tsx components/JobCard.tsx
git commit -m "Thread job description through to the client via RankedJobWithDescription"
```

---

## Task 2: Add skills-DB dependencies and env var

**Files:**
- Modify: `package.json`
- Modify: `.env.example`
- Create: `drizzle.config.ts`

**Interfaces:**
- Produces: `DATABASE_URL` env var (documented, not yet consumed until Task 6); `drizzle-kit` CLI configured against `lib/skills/db/schema.ts` (created in Task 3).

- [ ] **Step 1: Install dependencies**

Run:
```bash
npm install drizzle-orm @neondatabase/serverless
npm install -D drizzle-kit @electric-sql/pglite
```

- [ ] **Step 2: Add `DATABASE_URL` to `.env.example`**

```
ANTHROPIC_API_KEY=
ADZUNA_APP_ID=
ADZUNA_APP_KEY=
SITE_PASSWORD=
SESSION_SECRET=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
DATABASE_URL=
```

- [ ] **Step 3: Create `drizzle.config.ts`**

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./lib/skills/db/schema.ts",
  out: "./lib/skills/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

- [ ] **Step 4: Verify the install didn't break anything**

Run: `npm test && npx tsc --noEmit`
Expected: PASS (no new code uses these packages yet, this just confirms nothing collided).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .env.example drizzle.config.ts
git commit -m "Add drizzle/neon/pglite dependencies for the skills database"
```

---

## Task 3: Define the Drizzle schema for the four skills tables

**Files:**
- Create: `lib/skills/db/schema.ts`

**Interfaces:**
- Produces: `typeASkills`, `typeADependencies`, `skillEquivalenceGroups`, `skillEquivalenceMembers` (Drizzle table objects), and their inferred row types `TypeASkillRow`, `TypeADependencyRow`, `SkillEquivalenceGroupRow`, `SkillEquivalenceMemberRow`. Consumed by Task 4 (seed data typing), Task 5 (seed script), Task 6 (query layer).

- [ ] **Step 1: Write the schema**

```typescript
import {
  pgTable,
  serial,
  text,
  integer,
  primaryKey,
} from "drizzle-orm/pg-core";

export const typeASkills = pgTable("type_a_skills", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description").notNull(),
});

export const typeADependencies = pgTable(
  "type_a_dependencies",
  {
    skillId: integer("skill_id")
      .notNull()
      .references(() => typeASkills.id),
    dependsOnId: integer("depends_on_id")
      .notNull()
      .references(() => typeASkills.id),
  },
  (table) => [primaryKey({ columns: [table.skillId, table.dependsOnId] })]
);

export const skillEquivalenceGroups = pgTable("skill_equivalence_groups", {
  id: serial("id").primaryKey(),
  canonicalName: text("canonical_name").notNull(),
});

export const skillEquivalenceMembers = pgTable(
  "skill_equivalence_members",
  {
    groupId: integer("group_id")
      .notNull()
      .references(() => skillEquivalenceGroups.id),
    skillName: text("skill_name").notNull(),
  },
  (table) => [primaryKey({ columns: [table.groupId, table.skillName] })]
);

export type TypeASkillRow = typeof typeASkills.$inferSelect;
export type TypeADependencyRow = typeof typeADependencies.$inferSelect;
export type SkillEquivalenceGroupRow = typeof skillEquivalenceGroups.$inferSelect;
export type SkillEquivalenceMemberRow = typeof skillEquivalenceMembers.$inferSelect;
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/skills/db/schema.ts
git commit -m "Add drizzle schema for skills reference tables"
```

---

## Task 4: Author the curated seed data

This is real content, not scaffolding - it's the actual Type-A baseline list, its prerequisite DAG, and the Type-B equivalence groups the whole feature's accuracy depends on.

**Files:**
- Create: `lib/skills/data/seed.ts`
- Test: `lib/skills/data/seed.test.ts`

**Interfaces:**
- Produces: `TYPE_A_SKILLS: { name: string; description: string }[]`, `TYPE_A_DEPENDENCIES: { skill: string; dependsOn: string }[]` (both names reference `TYPE_A_SKILLS[].name`), `EQUIVALENCE_GROUPS: { canonicalName: string; members: string[] }[]`. Consumed by Task 5 (seed script) and Task 8's tests (topo-sort must not cycle on this real data).

- [ ] **Step 1: Write the failing test for internal consistency**

```typescript
import { describe, expect, it } from "vitest";
import { TYPE_A_SKILLS, TYPE_A_DEPENDENCIES, EQUIVALENCE_GROUPS } from "./seed";

describe("seed data", () => {
  it("has no duplicate Type-A skill names", () => {
    const names = TYPE_A_SKILLS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("only references Type-A names that exist in the baseline list", () => {
    const validNames = new Set(TYPE_A_SKILLS.map((s) => s.name));
    for (const dep of TYPE_A_DEPENDENCIES) {
      expect(validNames.has(dep.skill)).toBe(true);
      expect(validNames.has(dep.dependsOn)).toBe(true);
    }
  });

  it("has no self-dependencies", () => {
    for (const dep of TYPE_A_DEPENDENCIES) {
      expect(dep.skill).not.toBe(dep.dependsOn);
    }
  });

  it("has no cycles in the Type-A dependency graph", () => {
    const graph = new Map<string, string[]>();
    for (const dep of TYPE_A_DEPENDENCIES) {
      graph.set(dep.skill, [...(graph.get(dep.skill) ?? []), dep.dependsOn]);
    }
    const visiting = new Set<string>();
    const visited = new Set<string>();
    function hasCycle(node: string): boolean {
      if (visited.has(node)) return false;
      if (visiting.has(node)) return true;
      visiting.add(node);
      for (const next of graph.get(node) ?? []) {
        if (hasCycle(next)) return true;
      }
      visiting.delete(node);
      visited.add(node);
      return false;
    }
    for (const skill of TYPE_A_SKILLS.map((s) => s.name)) {
      expect(hasCycle(skill)).toBe(false);
    }
  });

  it("has no duplicate equivalence group canonical names", () => {
    const names = EQUIVALENCE_GROUPS.map((g) => g.canonicalName);
    expect(new Set(names).size).toBe(names.length);
  });

  it("has at least two members per equivalence group", () => {
    for (const group of EQUIVALENCE_GROUPS) {
      expect(group.members.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("does not list the same skill in two different equivalence groups", () => {
    const seen = new Map<string, string>();
    for (const group of EQUIVALENCE_GROUPS) {
      for (const member of group.members) {
        const key = member.toLowerCase();
        expect(seen.has(key)).toBe(false);
        seen.set(key, group.canonicalName);
      }
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- lib/skills/data/seed.test.ts`
Expected: FAIL with "Cannot find module './seed'" (file doesn't exist yet).

- [ ] **Step 3: Write the seed data**

```typescript
export const TYPE_A_SKILLS: { name: string; description: string }[] = [
  { name: "Version control (Git)", description: "Branching, merging, resolving conflicts, and collaborating via pull requests." },
  { name: "Data structures & algorithms", description: "Arrays, hash maps, trees, graphs, and their time/space complexity trade-offs." },
  { name: "Testing fundamentals", description: "Writing unit and integration tests, and reasoning about what a test should and shouldn't cover." },
  { name: "Relational database fundamentals", description: "Schema design, normalization, joins, indexes, and query performance basics." },
  { name: "Networking fundamentals", description: "TCP/IP, DNS, HTTP, and how requests actually travel between client and server." },
  { name: "Operating systems fundamentals", description: "Processes, threads, memory management, and concurrency primitives." },
  { name: "Linear algebra", description: "Vectors, matrices, and matrix operations underlying most machine learning math." },
  { name: "Probability & statistics", description: "Distributions, expectation, variance, and hypothesis testing fundamentals." },
  { name: "Object-oriented design", description: "Encapsulation, composition vs. inheritance, and designing clear interfaces between components." },
  { name: "Distributed systems fundamentals", description: "Consistency, availability, partitioning, and failure modes in multi-node systems." },
  { name: "System design", description: "Decomposing a large system into services, data stores, and APIs that meet real scale/latency requirements." },
  { name: "API design", description: "Designing clear, versionable HTTP/RPC interfaces between services or to clients." },
  { name: "Security fundamentals", description: "Authentication, authorization, common vulnerability classes (injection, XSS, CSRF), and secure-by-default practices." },
  { name: "CI/CD fundamentals", description: "Automating build, test, and deployment pipelines." },
  { name: "Cloud infrastructure fundamentals", description: "Provisioning and operating compute, storage, and networking on a cloud provider." },
  { name: "Machine learning fundamentals", description: "Supervised/unsupervised learning, training/evaluation splits, overfitting, and common model families." },
];

export const TYPE_A_DEPENDENCIES: { skill: string; dependsOn: string }[] = [
  { skill: "Testing fundamentals", dependsOn: "Object-oriented design" },
  { skill: "Distributed systems fundamentals", dependsOn: "Networking fundamentals" },
  { skill: "Distributed systems fundamentals", dependsOn: "Operating systems fundamentals" },
  { skill: "System design", dependsOn: "Distributed systems fundamentals" },
  { skill: "System design", dependsOn: "Relational database fundamentals" },
  { skill: "System design", dependsOn: "API design" },
  { skill: "API design", dependsOn: "Networking fundamentals" },
  { skill: "CI/CD fundamentals", dependsOn: "Version control (Git)" },
  { skill: "CI/CD fundamentals", dependsOn: "Testing fundamentals" },
  { skill: "Cloud infrastructure fundamentals", dependsOn: "Networking fundamentals" },
  { skill: "Security fundamentals", dependsOn: "Networking fundamentals" },
  { skill: "Machine learning fundamentals", dependsOn: "Linear algebra" },
  { skill: "Machine learning fundamentals", dependsOn: "Probability & statistics" },
];

export const EQUIVALENCE_GROUPS: { canonicalName: string; members: string[] }[] = [
  { canonicalName: "SSR frontend framework", members: ["Next.js", "Nuxt", "SvelteKit", "Remix"] },
  { canonicalName: "Frontend UI framework", members: ["React", "Vue", "Svelte", "Angular"] },
  { canonicalName: "Backend web framework (Node)", members: ["Express", "Fastify", "NestJS", "Koa"] },
  { canonicalName: "Backend web framework (Python)", members: ["Django", "Flask", "FastAPI"] },
  { canonicalName: "Relational database engine", members: ["PostgreSQL", "MySQL", "SQLite", "MariaDB"] },
  { canonicalName: "Document/NoSQL database", members: ["MongoDB", "DynamoDB", "Firestore", "CouchDB"] },
  { canonicalName: "In-memory cache/KV store", members: ["Redis", "Memcached", "Upstash Redis"] },
  { canonicalName: "Container orchestration", members: ["Kubernetes", "Docker Swarm", "Nomad"] },
  { canonicalName: "Infrastructure as code", members: ["Terraform", "Pulumi", "AWS CDK", "CloudFormation"] },
  { canonicalName: "CI/CD platform", members: ["GitHub Actions", "GitLab CI", "CircleCI", "Jenkins"] },
  { canonicalName: "Public cloud provider", members: ["AWS", "Google Cloud Platform", "Microsoft Azure"] },
  { canonicalName: "Message queue/broker", members: ["Kafka", "RabbitMQ", "AWS SQS", "Google Pub/Sub"] },
  { canonicalName: "Static typing for JavaScript", members: ["TypeScript", "Flow"] },
  { canonicalName: "Mobile cross-platform framework", members: ["React Native", "Flutter", "Ionic"] },
  { canonicalName: "GraphQL server library", members: ["Apollo Server", "GraphQL Yoga", "Mercurius"] },
  { canonicalName: "Python data/ML library", members: ["pandas", "NumPy", "scikit-learn"] },
  { canonicalName: "Deep learning framework", members: ["PyTorch", "TensorFlow", "JAX"] },
  { canonicalName: "Test runner/framework (JS)", members: ["Vitest", "Jest", "Mocha"] },
  { canonicalName: "End-to-end testing tool", members: ["Playwright", "Cypress", "Selenium"] },
  { canonicalName: "CSS framework", members: ["Tailwind CSS", "Bootstrap", "Chakra UI"] },
];
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- lib/skills/data/seed.test.ts`
Expected: PASS (all 7 assertions). If the cycle-detection or dangling-reference test fails, fix the specific `TYPE_A_DEPENDENCIES` entry it flags before proceeding - do not weaken the test.

- [ ] **Step 5: Commit**

```bash
git add lib/skills/data/seed.ts lib/skills/data/seed.test.ts
git commit -m "Add curated Type-A baseline, prerequisite DAG, and Type-B equivalence groups"
```

---

## Task 5: Idempotent seed script

**Files:**
- Create: `lib/skills/db/seedScript.ts`
- Modify: `package.json` (add a `db:seed` script)

**Interfaces:**
- Consumes: `TYPE_A_SKILLS`, `TYPE_A_DEPENDENCIES`, `EQUIVALENCE_GROUPS` (Task 4); `typeASkills`, `typeADependencies`, `skillEquivalenceGroups`, `skillEquivalenceMembers` (Task 3).
- Produces: a runnable script (`npm run db:seed`) that upserts the curated data into whatever `DATABASE_URL` points at. Not unit-tested here (it's an I/O script against a real DB) - it's exercised manually in Task 6's local setup and again in the final end-to-end pass (Task 14).

- [ ] **Step 1: Write the script**

```typescript
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import {
  typeASkills,
  typeADependencies,
  skillEquivalenceGroups,
  skillEquivalenceMembers,
} from "./schema";
import {
  TYPE_A_SKILLS,
  TYPE_A_DEPENDENCIES,
  EQUIVALENCE_GROUPS,
} from "../data/seed";

async function main() {
  const db = drizzle(neon(process.env.DATABASE_URL!));

  const skillIdByName = new Map<string, number>();
  for (const skill of TYPE_A_SKILLS) {
    const [row] = await db
      .insert(typeASkills)
      .values(skill)
      .onConflictDoUpdate({
        target: typeASkills.name,
        set: { description: skill.description },
      })
      .returning({ id: typeASkills.id, name: typeASkills.name });
    skillIdByName.set(row.name, row.id);
  }

  await db.delete(typeADependencies);
  for (const dep of TYPE_A_DEPENDENCIES) {
    await db.insert(typeADependencies).values({
      skillId: skillIdByName.get(dep.skill)!,
      dependsOnId: skillIdByName.get(dep.dependsOn)!,
    });
  }

  for (const group of EQUIVALENCE_GROUPS) {
    const existing = await db
      .select()
      .from(skillEquivalenceGroups)
      .where(eq(skillEquivalenceGroups.canonicalName, group.canonicalName));

    const groupId =
      existing[0]?.id ??
      (
        await db
          .insert(skillEquivalenceGroups)
          .values({ canonicalName: group.canonicalName })
          .returning({ id: skillEquivalenceGroups.id })
      )[0].id;

    await db
      .delete(skillEquivalenceMembers)
      .where(eq(skillEquivalenceMembers.groupId, groupId));

    for (const member of group.members) {
      await db
        .insert(skillEquivalenceMembers)
        .values({ groupId, skillName: member });
    }
  }

  console.log(
    `Seeded ${TYPE_A_SKILLS.length} Type-A skills, ${TYPE_A_DEPENDENCIES.length} dependency edges, ${EQUIVALENCE_GROUPS.length} equivalence groups.`
  );
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
```

- [ ] **Step 2: Add the npm script**

In `package.json`, inside `"scripts"`:

```json
    "db:seed": "tsx lib/skills/db/seedScript.ts"
```

Install `tsx` if not already present:

```bash
npm install -D tsx
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (Do not run `npm run db:seed` yet - there is no `DATABASE_URL` provisioned until Task 6's local setup step.)

- [ ] **Step 4: Commit**

```bash
git add lib/skills/db/seedScript.ts package.json package-lock.json
git commit -m "Add idempotent seed script for skills reference tables"
```

---

## Task 6: Read-only query layer (`queries.ts`) with pglite-backed tests

Note: the file is named `queries.ts`, not `db.ts` - this package already has a `lib/skills/db/` directory (schema, client, seed script). A sibling file also named `db.ts` would resolve correctly under Node/TS module rules (an exact-match file wins over a directory index), but it's a needless landmine for the next person reading this tree, so it isn't used.

**Files:**
- Create: `lib/skills/db/client.ts`
- Create: `lib/skills/queries.ts`
- Test: `lib/skills/queries.test.ts`

**Interfaces:**
- Produces: `getDb(): DbClient` (singleton factory for production/route use, mirrors `getRateLimiter()`'s pattern in `lib/rateLimit/index.ts`); `getTypeASkillNames(db): Promise<string[]>`; `getTypeADependencies(db): Promise<{ skill: string; dependsOn: string }[]>` (already resolved from ids to names - `topoSort.ts` in Task 8 never sees ids); `getEquivalenceGroups(db): Promise<{ canonicalName: string; members: string[] }[]>`. All three query functions take a `db` client as an explicit parameter (type `DbClient`, satisfied by both the Neon-backed client and the pglite test client) so they're testable without a network dependency.
- Consumes: `lib/skills/db/schema.ts` (Task 3).

- [ ] **Step 1: Write the DB client module**

```typescript
import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import * as schema from "./schema";

export type DbClient = ReturnType<typeof drizzleNeon<typeof schema>>;

let instance: DbClient | null = null;

export function getDb(): DbClient {
  if (!instance) {
    instance = drizzleNeon(neon(process.env.DATABASE_URL!), { schema });
  }
  return instance;
}
```

- [ ] **Step 2: Write the failing tests for the query layer**

```typescript
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import * as schema from "./db/schema";
import {
  getTypeASkillNames,
  getTypeADependencies,
  getEquivalenceGroups,
} from "./queries";

const pglite = new PGlite();
const testDb = drizzle(pglite, { schema });

beforeAll(async () => {
  await testDb.execute(sql`
    CREATE TABLE type_a_skills (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL
    );
    CREATE TABLE type_a_dependencies (
      skill_id INTEGER NOT NULL REFERENCES type_a_skills(id),
      depends_on_id INTEGER NOT NULL REFERENCES type_a_skills(id),
      PRIMARY KEY (skill_id, depends_on_id)
    );
    CREATE TABLE skill_equivalence_groups (
      id SERIAL PRIMARY KEY,
      canonical_name TEXT NOT NULL
    );
    CREATE TABLE skill_equivalence_members (
      group_id INTEGER NOT NULL REFERENCES skill_equivalence_groups(id),
      skill_name TEXT NOT NULL,
      PRIMARY KEY (group_id, skill_name)
    );
  `);
});

afterAll(async () => {
  await pglite.close();
});

beforeEach(async () => {
  await testDb.execute(sql`
    TRUNCATE type_a_dependencies, type_a_skills,
    skill_equivalence_members, skill_equivalence_groups RESTART IDENTITY CASCADE;
  `);
});

describe("getTypeASkillNames", () => {
  it("returns the names of all seeded Type-A skills", async () => {
    await testDb.insert(schema.typeASkills).values([
      { name: "Git", description: "Version control." },
      { name: "Testing", description: "Writing tests." },
    ]);

    const names = await getTypeASkillNames(testDb);

    expect(names.sort()).toEqual(["Git", "Testing"]);
  });

  it("returns an empty array when no skills are seeded", async () => {
    expect(await getTypeASkillNames(testDb)).toEqual([]);
  });
});

describe("getTypeADependencies", () => {
  it("resolves dependency edges to skill names", async () => {
    const [git, ci] = await testDb
      .insert(schema.typeASkills)
      .values([
        { name: "Git", description: "Version control." },
        { name: "CI/CD", description: "Pipelines." },
      ])
      .returning();
    await testDb
      .insert(schema.typeADependencies)
      .values({ skillId: ci.id, dependsOnId: git.id });

    const deps = await getTypeADependencies(testDb);

    expect(deps).toEqual([{ skill: "CI/CD", dependsOn: "Git" }]);
  });
});

describe("getEquivalenceGroups", () => {
  it("groups members under their canonical name", async () => {
    const [group] = await testDb
      .insert(schema.skillEquivalenceGroups)
      .values({ canonicalName: "SSR frontend framework" })
      .returning();
    await testDb.insert(schema.skillEquivalenceMembers).values([
      { groupId: group.id, skillName: "Next.js" },
      { groupId: group.id, skillName: "Nuxt" },
    ]);

    const groups = await getEquivalenceGroups(testDb);

    expect(groups).toEqual([
      { canonicalName: "SSR frontend framework", members: ["Next.js", "Nuxt"] },
    ]);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- lib/skills/queries.test.ts`
Expected: FAIL with "Cannot find module './queries'" (query functions don't exist yet).

- [ ] **Step 4: Implement the query layer**

```typescript
import { eq } from "drizzle-orm";
import type { DbClient } from "./db/client";
import {
  typeASkills,
  typeADependencies,
  skillEquivalenceGroups,
  skillEquivalenceMembers,
} from "./db/schema";

export async function getTypeASkillNames(db: DbClient): Promise<string[]> {
  const rows = await db.select({ name: typeASkills.name }).from(typeASkills);
  return rows.map((r) => r.name);
}

export async function getTypeADependencies(
  db: DbClient
): Promise<{ skill: string; dependsOn: string }[]> {
  const rows = await db
    .select({
      skill: typeASkills.name,
      dependsOnId: typeADependencies.dependsOnId,
    })
    .from(typeADependencies)
    .innerJoin(typeASkills, eq(typeADependencies.skillId, typeASkills.id));

  const namesById = new Map(
    (await db.select().from(typeASkills)).map((s) => [s.id, s.name])
  );

  return rows.map((r) => ({
    skill: r.skill,
    dependsOn: namesById.get(r.dependsOnId)!,
  }));
}

export async function getEquivalenceGroups(
  db: DbClient
): Promise<{ canonicalName: string; members: string[] }[]> {
  const groups = await db.select().from(skillEquivalenceGroups);
  const members = await db.select().from(skillEquivalenceMembers);

  const membersByGroupId = new Map<number, string[]>();
  for (const m of members) {
    membersByGroupId.set(m.groupId, [
      ...(membersByGroupId.get(m.groupId) ?? []),
      m.skillName,
    ]);
  }

  return groups.map((g) => ({
    canonicalName: g.canonicalName,
    members: membersByGroupId.get(g.id) ?? [],
  }));
}
```

Note: `getTypeADependencies` does a second full-table read of `typeASkills` to resolve `dependsOnId` to a name (Drizzle doesn't let you join the same table twice under different aliases without an explicit alias helper, and this table has at most a few dozen rows, so a second read is simpler than aliasing and has no meaningful cost). If a reviewer wants the alias version instead, use `drizzle-orm`'s `alias()` helper - functionally equivalent, not required for correctness.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- lib/skills/queries.test.ts`
Expected: PASS

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/skills/db/client.ts lib/skills/queries.ts lib/skills/queries.test.ts
git commit -m "Add read-only query layer for skills reference tables"
```

---

## Task 7: `matchSkills.ts`

**Files:**
- Create: `lib/skills/matchSkills.ts`
- Test: `lib/skills/matchSkills.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks at the type level (pure function, plain input types defined in this file).
- Produces: `ResumeSkill`, `JobRequirement`, `EquivalenceGroup`, `MatchedSkill`, `SkillGap`, `MatchResult` types, and `matchSkills(resumeSkills, jobRequirements, typeASkillNames, equivalenceGroups): MatchResult`. Consumed by Task 11 (`loop.ts`).

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, expect, it } from "vitest";
import { matchSkills } from "./matchSkills";

describe("matchSkills", () => {
  it("matches a Type-A requirement the resume shows evidence for", () => {
    const result = matchSkills(
      [{ skill: "Testing fundamentals", type: "A", confidence: "High", evidence: "Wrote unit tests at Acme." }],
      [{ skill: "Testing fundamentals", importance: "required" }],
      ["Testing fundamentals"],
      []
    );

    expect(result.matched).toEqual([
      { requiredSkill: "Testing fundamentals", importance: "required", matchedBy: "Testing fundamentals", confidence: "High" },
    ]);
    expect(result.gaps).toEqual([]);
  });

  it("treats an unmatched Type-A requirement as a Type-A gap", () => {
    const result = matchSkills(
      [],
      [{ skill: "System design", importance: "required" }],
      ["System design"],
      []
    );

    expect(result.gaps).toEqual([
      { skill: "System design", type: "A", importance: "required" },
    ]);
  });

  it("matches a Type-B requirement via a curated equivalence group", () => {
    const result = matchSkills(
      [{ skill: "Vue", type: "B", confidence: "High", evidence: "Built a Vue app." }],
      [{ skill: "Next.js", importance: "preferred" }],
      [],
      [{ canonicalName: "SSR frontend framework", members: ["Next.js", "Nuxt", "Vue"] }]
    );

    expect(result.matched).toEqual([
      { requiredSkill: "Next.js", importance: "preferred", matchedBy: "Vue", confidence: "High" },
    ]);
    expect(result.gaps).toEqual([]);
  });

  it("flags a Medium/Low confidence match as needing confirmation", () => {
    const result = matchSkills(
      [{ skill: "Kafka", type: "B", confidence: "Low", evidence: "Course title mentioned messaging." }],
      [{ skill: "RabbitMQ", importance: "required" }],
      [],
      [{ canonicalName: "Message queue/broker", members: ["Kafka", "RabbitMQ"] }]
    );

    expect(result.matched).toEqual([
      { requiredSkill: "RabbitMQ", importance: "required", matchedBy: "Kafka", confidence: "Low" },
    ]);
  });

  it("falls back to a direct case-insensitive name match when a Type-B skill isn't in any curated group", () => {
    const result = matchSkills(
      [{ skill: "graphql", type: "B", confidence: "High", evidence: "Built a GraphQL API." }],
      [{ skill: "GraphQL", importance: "required" }],
      [],
      []
    );

    expect(result.matched).toEqual([
      { requiredSkill: "GraphQL", importance: "required", matchedBy: "graphql", confidence: "High" },
    ]);
  });

  it("treats an unmatched Type-B requirement with no equivalence group as a Type-B gap", () => {
    const result = matchSkills(
      [],
      [{ skill: "Rust", importance: "preferred" }],
      [],
      []
    );

    expect(result.gaps).toEqual([
      { skill: "Rust", type: "B", importance: "preferred" },
    ]);
  });

  it("returns no matches or gaps when there are no job requirements", () => {
    const result = matchSkills(
      [{ skill: "Testing fundamentals", type: "A", confidence: "High", evidence: "x" }],
      [],
      ["Testing fundamentals"],
      []
    );

    expect(result).toEqual({ matched: [], gaps: [] });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- lib/skills/matchSkills.test.ts`
Expected: FAIL with "Cannot find module './matchSkills'"

- [ ] **Step 3: Implement `matchSkills.ts`**

```typescript
export interface ResumeSkill {
  skill: string;
  type: "A" | "B";
  confidence: "High" | "Medium" | "Low";
  evidence: string;
}

export interface JobRequirement {
  skill: string;
  importance: "required" | "preferred";
}

export interface EquivalenceGroup {
  canonicalName: string;
  members: string[];
}

export interface MatchedSkill {
  requiredSkill: string;
  importance: "required" | "preferred";
  matchedBy: string;
  confidence: "High" | "Medium" | "Low";
}

export interface SkillGap {
  skill: string;
  type: "A" | "B";
  importance: "required" | "preferred";
}

export interface MatchResult {
  matched: MatchedSkill[];
  gaps: SkillGap[];
}

function normalize(name: string): string {
  return name.trim().toLowerCase();
}

function findGroupContaining(
  skill: string,
  groups: EquivalenceGroup[]
): EquivalenceGroup | undefined {
  const target = normalize(skill);
  return groups.find((g) => g.members.some((m) => normalize(m) === target));
}

export function matchSkills(
  resumeSkills: ResumeSkill[],
  jobRequirements: JobRequirement[],
  typeASkillNames: string[],
  equivalenceGroups: EquivalenceGroup[]
): MatchResult {
  const typeASet = new Set(typeASkillNames.map(normalize));
  const matched: MatchedSkill[] = [];
  const gaps: SkillGap[] = [];

  for (const req of jobRequirements) {
    const isTypeA = typeASet.has(normalize(req.skill));

    if (isTypeA) {
      const evidence = resumeSkills.find(
        (s) => s.type === "A" && normalize(s.skill) === normalize(req.skill)
      );
      if (evidence) {
        matched.push({
          requiredSkill: req.skill,
          importance: req.importance,
          matchedBy: evidence.skill,
          confidence: evidence.confidence,
        });
      } else {
        gaps.push({ skill: req.skill, type: "A", importance: req.importance });
      }
      continue;
    }

    const group = findGroupContaining(req.skill, equivalenceGroups);
    if (group) {
      const memberNames = new Set(group.members.map(normalize));
      const evidence = resumeSkills.find(
        (s) => s.type === "B" && memberNames.has(normalize(s.skill))
      );
      if (evidence) {
        matched.push({
          requiredSkill: req.skill,
          importance: req.importance,
          matchedBy: evidence.skill,
          confidence: evidence.confidence,
        });
        continue;
      }
    } else {
      const evidence = resumeSkills.find(
        (s) => s.type === "B" && normalize(s.skill) === normalize(req.skill)
      );
      if (evidence) {
        matched.push({
          requiredSkill: req.skill,
          importance: req.importance,
          matchedBy: evidence.skill,
          confidence: evidence.confidence,
        });
        continue;
      }
    }

    gaps.push({ skill: req.skill, type: "B", importance: req.importance });
  }

  return { matched, gaps };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- lib/skills/matchSkills.test.ts`
Expected: PASS (all 7 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/skills/matchSkills.ts lib/skills/matchSkills.test.ts
git commit -m "Add deterministic skill matching against job requirements"
```

---

## Task 8: `topoSort.ts`

**Files:**
- Create: `lib/skills/topoSort.ts`
- Test: `lib/skills/topoSort.test.ts`

**Interfaces:**
- Produces: `DependencyEdge` type, `topoSortTypeAGaps(gapSkillNames: string[], dependencies: DependencyEdge[]): string[]`. Consumed by Task 11 (`loop.ts`).

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, expect, it } from "vitest";
import { topoSortTypeAGaps } from "./topoSort";

describe("topoSortTypeAGaps", () => {
  it("orders a simple two-node chain with the prerequisite first", () => {
    const order = topoSortTypeAGaps(
      ["System design", "Networking fundamentals"],
      [{ skill: "System design", dependsOn: "Networking fundamentals" }]
    );

    expect(order).toEqual(["Networking fundamentals", "System design"]);
  });

  it("ignores dependency edges to skills that aren't in the gap list", () => {
    const order = topoSortTypeAGaps(
      ["System design"],
      [{ skill: "System design", dependsOn: "Networking fundamentals" }]
    );

    expect(order).toEqual(["System design"]);
  });

  it("returns skills with no dependencies among the gaps in their original order", () => {
    const order = topoSortTypeAGaps(["Git", "Testing fundamentals"], []);

    expect(order).toEqual(["Git", "Testing fundamentals"]);
  });

  it("handles a diamond dependency correctly", () => {
    const order = topoSortTypeAGaps(
      ["System design", "Distributed systems fundamentals", "Relational database fundamentals", "Networking fundamentals"],
      [
        { skill: "System design", dependsOn: "Distributed systems fundamentals" },
        { skill: "System design", dependsOn: "Relational database fundamentals" },
        { skill: "Distributed systems fundamentals", dependsOn: "Networking fundamentals" },
      ]
    );

    expect(order.indexOf("Networking fundamentals")).toBeLessThan(
      order.indexOf("Distributed systems fundamentals")
    );
    expect(order.indexOf("Distributed systems fundamentals")).toBeLessThan(
      order.indexOf("System design")
    );
    expect(order.indexOf("Relational database fundamentals")).toBeLessThan(
      order.indexOf("System design")
    );
    expect(order).toHaveLength(4);
  });

  it("returns an empty array for an empty gap list", () => {
    expect(topoSortTypeAGaps([], [])).toEqual([]);
  });

  it("falls back to the original gap order without throwing when the edges contain a cycle", () => {
    const order = topoSortTypeAGaps(
      ["A", "B"],
      [
        { skill: "A", dependsOn: "B" },
        { skill: "B", dependsOn: "A" },
      ]
    );

    expect(order.sort()).toEqual(["A", "B"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- lib/skills/topoSort.test.ts`
Expected: FAIL with "Cannot find module './topoSort'"

- [ ] **Step 3: Implement `topoSort.ts`**

Kahn's algorithm over the subgraph induced on `gapSkillNames` only (edges to non-gap skills are dropped, since a prerequisite the user already has isn't something to order):

```typescript
export interface DependencyEdge {
  skill: string;
  dependsOn: string;
}

export function topoSortTypeAGaps(
  gapSkillNames: string[],
  dependencies: DependencyEdge[]
): string[] {
  const gapSet = new Set(gapSkillNames);
  const relevantEdges = dependencies.filter(
    (e) => gapSet.has(e.skill) && gapSet.has(e.dependsOn)
  );

  const inDegree = new Map<string, number>(gapSkillNames.map((s) => [s, 0]));
  const dependents = new Map<string, string[]>();
  for (const edge of relevantEdges) {
    inDegree.set(edge.skill, (inDegree.get(edge.skill) ?? 0) + 1);
    dependents.set(edge.dependsOn, [
      ...(dependents.get(edge.dependsOn) ?? []),
      edge.skill,
    ]);
  }

  const queue = gapSkillNames.filter((s) => inDegree.get(s) === 0);
  const order: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    order.push(current);
    for (const dependent of dependents.get(current) ?? []) {
      const remaining = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, remaining);
      if (remaining === 0) queue.push(dependent);
    }
  }

  if (order.length !== gapSkillNames.length) {
    // A cycle in the curated data (should be caught by seed.test.ts, but
    // don't let a data-authoring mistake break the request) - fall back
    // to the original, unordered gap list rather than throwing.
    return gapSkillNames;
  }

  return order;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- lib/skills/topoSort.test.ts`
Expected: PASS (all 6 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/skills/topoSort.ts lib/skills/topoSort.test.ts
git commit -m "Add topological sort for Type-A skill gap ordering"
```

---

## Task 9: Zod schemas for the two Claude extraction outputs

**Files:**
- Create: `lib/skills/schema.ts`
- Test: `lib/skills/schema.test.ts`

**Interfaces:**
- Consumes: nothing (plain zod).
- Produces: `buildResumeSkillsSchema(validTypeANames: string[])` returning a zod schema whose parsed type is `ResumeSkill[]` (matching Task 7's `ResumeSkill` shape); `JobRequirementsSchema` (static) whose parsed type is `JobRequirement[]` (matching Task 7's `JobRequirement` shape); `parseResumeSkills(raw, validTypeANames)`, `parseJobRequirements(raw)`. Consumed by Task 11 (`loop.ts`).

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, expect, it } from "vitest";
import { parseResumeSkills, parseJobRequirements } from "./schema";

describe("parseResumeSkills", () => {
  const validTypeANames = ["Testing fundamentals", "System design"];

  it("accepts a well-formed mix of Type-A and Type-B entries", () => {
    const result = parseResumeSkills(
      {
        skills: [
          { skill: "Testing fundamentals", type: "A", confidence: "High", evidence: "Wrote unit tests." },
          { skill: "Next.js", type: "B", confidence: "Low", evidence: "Took a course titled 'Modern Web Frameworks'." },
        ],
      },
      validTypeANames
    );

    expect(result).toHaveLength(2);
  });

  it("rejects a Type-A entry with Low confidence", () => {
    expect(() =>
      parseResumeSkills(
        {
          skills: [
            { skill: "Testing fundamentals", type: "A", confidence: "Low", evidence: "Course title mentioned it." },
          ],
        },
        validTypeANames
      )
    ).toThrow();
  });

  it("rejects a Type-A entry whose name is outside the baseline list", () => {
    expect(() =>
      parseResumeSkills(
        {
          skills: [
            { skill: "Quantum computing", type: "A", confidence: "High", evidence: "Explicitly stated." },
          ],
        },
        validTypeANames
      )
    ).toThrow();
  });

  it("rejects a Type-B entry with an invalid confidence value", () => {
    expect(() =>
      parseResumeSkills(
        {
          skills: [{ skill: "Rust", type: "B", confidence: "Certain", evidence: "x" }],
        },
        validTypeANames
      )
    ).toThrow();
  });
});

describe("parseJobRequirements", () => {
  it("accepts a well-formed list", () => {
    const result = parseJobRequirements({
      requirements: [{ skill: "TypeScript", importance: "required" }],
    });

    expect(result).toEqual([{ skill: "TypeScript", importance: "required" }]);
  });

  it("rejects an invalid importance value", () => {
    expect(() =>
      parseJobRequirements({
        requirements: [{ skill: "TypeScript", importance: "mandatory" }],
      })
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- lib/skills/schema.test.ts`
Expected: FAIL with "Cannot find module './schema'"

- [ ] **Step 3: Implement `schema.ts`**

```typescript
import { z } from "zod";
import type { ResumeSkill, JobRequirement } from "./matchSkills";

const ConfidenceSchema = z.enum(["High", "Medium", "Low"]);

export function buildResumeSkillsSchema(validTypeANames: string[]) {
  const validTypeASet = new Set(validTypeANames);

  const ResumeSkillSchema = z
    .object({
      skill: z.string(),
      type: z.enum(["A", "B"]),
      confidence: ConfidenceSchema,
      evidence: z.string(),
    })
    .superRefine((entry, ctx) => {
      if (entry.type !== "A") return;
      if (entry.confidence === "Low") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Type-A skill "${entry.skill}" cannot have Low confidence - Type-A skills are never guessed from a course title alone.`,
        });
      }
      if (!validTypeASet.has(entry.skill)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `"${entry.skill}" is not in the curated Type-A baseline list.`,
        });
      }
    });

  return z.object({ skills: z.array(ResumeSkillSchema) });
}

export const JobRequirementsSchema = z.object({
  requirements: z.array(
    z.object({
      skill: z.string(),
      importance: z.enum(["required", "preferred"]),
    })
  ),
});

export function parseResumeSkills(
  raw: unknown,
  validTypeANames: string[]
): ResumeSkill[] {
  return buildResumeSkillsSchema(validTypeANames).parse(raw).skills;
}

export function parseJobRequirements(raw: unknown): JobRequirement[] {
  return JobRequirementsSchema.parse(raw).requirements;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- lib/skills/schema.test.ts`
Expected: PASS (all 6 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/skills/schema.ts lib/skills/schema.test.ts
git commit -m "Add schema validation for skill extraction outputs"
```

---

## Task 10: Anthropic tool definitions and system prompts

**Files:**
- Create: `lib/skills/tools.ts`
- Create: `lib/skills/systemPrompt.ts`

**Interfaces:**
- Produces: `REPORT_SKILLS_TOOL: Anthropic.Tool`, `REPORT_REQUIREMENTS_TOOL: Anthropic.Tool`, `RESUME_SKILLS_SYSTEM_PROMPT(typeABaseline: { name: string; description: string }[]): string`, `JOB_REQUIREMENTS_SYSTEM_PROMPT: string`. Consumed by Task 11 (`loop.ts`).

No test file for this task - these are static/templated string and object literals with no branching logic to unit test (consistent with `lib/agent/tools.ts` and `lib/agent/systemPrompt.ts`, neither of which has a test file). Correctness here is verified indirectly by Task 11's loop tests (which assert the right tool names are used) and the Task 14 manual end-to-end pass.

- [ ] **Step 1: Write `tools.ts`**

```typescript
import type Anthropic from "@anthropic-ai/sdk";

export const REPORT_SKILLS_TOOL: Anthropic.Tool = {
  name: "report_resume_skills",
  description:
    "Report the skills inferred from the candidate's resume, each tagged with a type and confidence tier. Call this exactly once.",
  input_schema: {
    type: "object",
    properties: {
      skills: {
        type: "array",
        items: {
          type: "object",
          properties: {
            skill: { type: "string" },
            type: {
              type: "string",
              enum: ["A", "B"],
              description:
                "A = evergreen core skill from the provided baseline list only. B = any other specific framework/tool/technology.",
            },
            confidence: {
              type: "string",
              enum: ["High", "Medium", "Low"],
              description:
                "High = explicit resume/project/work experience. Medium = explicitly named in a syllabus/course outline. Low = guessed from a course title alone. Type A skills must be High or Medium, never Low.",
            },
            evidence: {
              type: "string",
              description: "The specific resume text this was inferred from.",
            },
          },
          required: ["skill", "type", "confidence", "evidence"],
        },
      },
    },
    required: ["skills"],
  },
};

export const REPORT_REQUIREMENTS_TOOL: Anthropic.Tool = {
  name: "report_job_requirements",
  description:
    "Report the skills required or preferred by this job posting. Call this exactly once.",
  input_schema: {
    type: "object",
    properties: {
      requirements: {
        type: "array",
        items: {
          type: "object",
          properties: {
            skill: { type: "string" },
            importance: {
              type: "string",
              enum: ["required", "preferred"],
              description:
                "required if the posting states or clearly implies this is mandatory, preferred otherwise.",
            },
          },
          required: ["skill", "importance"],
        },
      },
    },
    required: ["requirements"],
  },
};
```

- [ ] **Step 2: Write `systemPrompt.ts`**

```typescript
export function RESUME_SKILLS_SYSTEM_PROMPT(
  typeABaseline: { name: string; description: string }[]
): string {
  const baselineList = typeABaseline
    .map((s) => `- ${s.name}: ${s.description}`)
    .join("\n");

  return `You are extracting skills from a candidate's resume for a skill-gap analysis.

Evergreen core skills (Type A) are ONLY the following - do not invent others, and do not report a Type-A skill unless the resume gives explicit evidence for it (either directly, or via an explicitly named course/project/work experience):
${baselineList}

For each Type-A skill above with explicit evidence in the resume, report it with type "A" and confidence "High" (explicit resume/project/work experience) or "Medium" (explicitly named in a syllabus/course outline). Never report a Type-A skill at "Low" confidence, and never report a Type-A skill outside this list.

Any other specific skill, framework, tool, or technology you find evidence for - explicit or inferred from a course - report as type "B", at whatever confidence tier fits: "High" for explicit resume/project/work evidence, "Medium" for an explicitly named syllabus/course-outline technology, "Low" for a skill you're inferring purely from a course title with no further detail (e.g. inferring "computer vision" from a course titled "CS 4501: Special Topics" with no syllabus content).

Call report_resume_skills exactly once with everything you found.`;
}

export const JOB_REQUIREMENTS_SYSTEM_PROMPT = `You are extracting the skills required or preferred by a job posting for a skill-gap analysis.

Read the job title and description, and list every specific skill, technology, or competency it asks for - both explicitly required ones and "nice to have"/preferred ones, using whatever the posting's own language implies about which is which. Use the posting's own wording for each skill name where possible (e.g. if it says "Next.js", report "Next.js", not "SSR framework").

Call report_job_requirements exactly once with everything you found.`;
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/skills/tools.ts lib/skills/systemPrompt.ts
git commit -m "Add Anthropic tool definitions and system prompts for skill extraction"
```

---

## Task 11: `loop.ts` orchestration

**Files:**
- Create: `lib/skills/loop.ts`
- Test: `lib/skills/loop.test.ts`

**Interfaces:**
- Consumes: `REPORT_SKILLS_TOOL`, `REPORT_REQUIREMENTS_TOOL` (Task 10); `RESUME_SKILLS_SYSTEM_PROMPT`, `JOB_REQUIREMENTS_SYSTEM_PROMPT` (Task 10); `parseResumeSkills`, `parseJobRequirements` (Task 9); `matchSkills`, `MatchResult` (Task 7); `topoSortTypeAGaps` (Task 8); `getTypeASkillNames`, `getTypeADependencies`, `getEquivalenceGroups` (Task 6); `Job` type (`lib/tools/types.ts`, existing - for the target job's `title`/`description`).
- Produces: `SkillGapEvent` (discriminated union like `AgentEvent`), `runSkillGapAnalysis(client, db, resume, job): AsyncGenerator<SkillGapEvent>`. Consumed by Task 12 (`route.ts`).

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { runSkillGapAnalysis, type SkillGapEvent } from "./loop";
import type { DbClient } from "./db/client";

async function collect(
  gen: AsyncGenerator<SkillGapEvent>
): Promise<SkillGapEvent[]> {
  const events: SkillGapEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

function fakeClient(responses: Anthropic.Message[]): Anthropic {
  let call = 0;
  return {
    messages: {
      create: vi.fn().mockImplementation(async () => {
        const response = responses[Math.min(call, responses.length - 1)];
        call++;
        return response;
      }),
    },
  } as unknown as Anthropic;
}

const fakeDb = {} as DbClient;

vi.mock("./queries", () => ({
  getTypeASkillNames: vi.fn().mockResolvedValue(["Testing fundamentals"]),
  getTypeADependencies: vi.fn().mockResolvedValue([]),
  getEquivalenceGroups: vi.fn().mockResolvedValue([]),
}));

const job = {
  source: "adzuna" as const,
  title: "Backend Engineer",
  company: "Acme",
  location: "Remote",
  url: "https://example.com/1",
  description: "Looking for someone with strong testing fundamentals.",
};

describe("runSkillGapAnalysis", () => {
  it("runs both extraction calls and yields a final result", async () => {
    const client = fakeClient([
      {
        content: [
          {
            type: "tool_use",
            id: "call_1",
            name: "report_resume_skills",
            input: {
              skills: [
                { skill: "Testing fundamentals", type: "A", confidence: "High", evidence: "Wrote unit tests." },
              ],
            },
          },
        ],
      } as unknown as Anthropic.Message,
      {
        content: [
          {
            type: "tool_use",
            id: "call_2",
            name: "report_job_requirements",
            input: {
              requirements: [{ skill: "Testing fundamentals", importance: "required" }],
            },
          },
        ],
      } as unknown as Anthropic.Message,
    ]);

    const events = await collect(runSkillGapAnalysis(client, fakeDb, "resume text", job));

    const resultEvent = events.find((e) => e.type === "result");
    expect(resultEvent).toMatchObject({
      type: "result",
      data: {
        matched: [
          { requiredSkill: "Testing fundamentals", importance: "required", matchedBy: "Testing fundamentals", confidence: "High" },
        ],
        typeAGapsOrdered: [],
        typeBGaps: [],
      },
    });
    expect(events.some((e) => e.type === "progress")).toBe(true);
  });

  it("yields an error when the first Claude call throws", async () => {
    const client = {
      messages: { create: vi.fn().mockRejectedValue(new Error("api down")) },
    } as unknown as Anthropic;

    const events = await collect(runSkillGapAnalysis(client, fakeDb, "resume text", job));

    expect(events).toEqual([{ type: "error", message: "api down" }]);
  });

  it("yields an error when resume-skills output fails schema validation", async () => {
    const client = fakeClient([
      {
        content: [
          {
            type: "tool_use",
            id: "call_1",
            name: "report_resume_skills",
            input: {
              skills: [
                { skill: "Testing fundamentals", type: "A", confidence: "Low", evidence: "Course title only." },
              ],
            },
          },
        ],
      } as unknown as Anthropic.Message,
    ]);

    const events = await collect(runSkillGapAnalysis(client, fakeDb, "resume text", job));

    expect(events.at(-1)).toMatchObject({ type: "error" });
  });

  it("orders Type-A gaps via topoSort before yielding the result", async () => {
    const { getTypeADependencies, getTypeASkillNames } = await import(
      "./queries"
    );
    vi.mocked(getTypeADependencies).mockResolvedValueOnce([
      { skill: "System design", dependsOn: "Networking fundamentals" },
    ]);
    vi.mocked(getTypeASkillNames).mockResolvedValueOnce([
      "System design",
      "Networking fundamentals",
    ]);

    const client = fakeClient([
      {
        content: [
          { type: "tool_use", id: "call_1", name: "report_resume_skills", input: { skills: [] } },
        ],
      } as unknown as Anthropic.Message,
      {
        content: [
          {
            type: "tool_use",
            id: "call_2",
            name: "report_job_requirements",
            input: {
              requirements: [
                { skill: "System design", importance: "required" },
                { skill: "Networking fundamentals", importance: "required" },
              ],
            },
          },
        ],
      } as unknown as Anthropic.Message,
    ]);

    const events = await collect(runSkillGapAnalysis(client, fakeDb, "resume text", job));

    const resultEvent = events.find((e) => e.type === "result");
    expect(resultEvent).toMatchObject({
      data: { typeAGapsOrdered: ["Networking fundamentals", "System design"] },
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- lib/skills/loop.test.ts`
Expected: FAIL with "Cannot find module './loop'"

- [ ] **Step 3: Implement `loop.ts`**

```typescript
import type Anthropic from "@anthropic-ai/sdk";
import { REPORT_SKILLS_TOOL, REPORT_REQUIREMENTS_TOOL } from "./tools";
import {
  RESUME_SKILLS_SYSTEM_PROMPT,
  JOB_REQUIREMENTS_SYSTEM_PROMPT,
} from "./systemPrompt";
import { parseResumeSkills, parseJobRequirements } from "./schema";
import { matchSkills, type MatchResult } from "./matchSkills";
import { topoSortTypeAGaps } from "./topoSort";
import {
  getTypeASkillNames,
  getTypeADependencies,
  getEquivalenceGroups,
} from "./queries";
import type { DbClient } from "./db/client";
import type { Job } from "../tools/types";

const MODEL = "claude-sonnet-5";

export type SkillGapResult = {
  matched: MatchResult["matched"];
  typeAGapsOrdered: string[];
  typeBGaps: MatchResult["gaps"];
};

export type SkillGapEvent =
  | { type: "progress"; message: string }
  | { type: "result"; data: SkillGapResult }
  | { type: "error"; message: string };

export async function* runSkillGapAnalysis(
  client: Anthropic,
  db: DbClient,
  resume: string,
  job: Pick<Job, "title" | "description">
): AsyncGenerator<SkillGapEvent> {
  const [typeASkillNames, typeADependencies, equivalenceGroups] =
    await Promise.all([
      getTypeASkillNames(db),
      getTypeADependencies(db),
      getEquivalenceGroups(db),
    ]);

  yield { type: "progress", message: "Reading resume..." };

  let resumeResponse: Anthropic.Message;
  try {
    resumeResponse = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: RESUME_SKILLS_SYSTEM_PROMPT(
        typeASkillNames.map((name) => ({ name, description: "" }))
      ),
      tools: [REPORT_SKILLS_TOOL],
      tool_choice: { type: "tool", name: "report_resume_skills" },
      messages: [{ role: "user", content: `Resume:\n${resume}` }],
    } as Anthropic.MessageCreateParamsNonStreaming);
  } catch (err) {
    yield {
      type: "error",
      message: err instanceof Error ? err.message : "Claude API error",
    };
    return;
  }

  const resumeToolUse = resumeResponse.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
  );
  if (!resumeToolUse) {
    yield { type: "error", message: "Agent did not report resume skills" };
    return;
  }

  let resumeSkills;
  try {
    resumeSkills = parseResumeSkills(resumeToolUse.input, typeASkillNames);
  } catch (err) {
    yield {
      type: "error",
      message:
        "Agent returned malformed resume skills: " +
        (err instanceof Error ? err.message : "unknown"),
    };
    return;
  }

  yield { type: "progress", message: "Reading job requirements..." };

  let jobResponse: Anthropic.Message;
  try {
    jobResponse = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: JOB_REQUIREMENTS_SYSTEM_PROMPT,
      tools: [REPORT_REQUIREMENTS_TOOL],
      tool_choice: { type: "tool", name: "report_job_requirements" },
      messages: [
        {
          role: "user",
          content: `Job title: ${job.title}\n\nJob description:\n${job.description}`,
        },
      ],
    } as Anthropic.MessageCreateParamsNonStreaming);
  } catch (err) {
    yield {
      type: "error",
      message: err instanceof Error ? err.message : "Claude API error",
    };
    return;
  }

  const jobToolUse = jobResponse.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
  );
  if (!jobToolUse) {
    yield { type: "error", message: "Agent did not report job requirements" };
    return;
  }

  let jobRequirements;
  try {
    jobRequirements = parseJobRequirements(jobToolUse.input);
  } catch (err) {
    yield {
      type: "error",
      message:
        "Agent returned malformed job requirements: " +
        (err instanceof Error ? err.message : "unknown"),
    };
    return;
  }

  yield { type: "progress", message: "Computing gaps..." };

  const { matched, gaps } = matchSkills(
    resumeSkills,
    jobRequirements,
    typeASkillNames,
    equivalenceGroups
  );

  const typeAGapNames = gaps.filter((g) => g.type === "A").map((g) => g.skill);
  const typeAGapsOrdered = topoSortTypeAGaps(typeAGapNames, typeADependencies);
  const typeBGaps = gaps.filter((g) => g.type === "B");

  yield { type: "result", data: { matched, typeAGapsOrdered, typeBGaps } };
}
```

Note: `RESUME_SKILLS_SYSTEM_PROMPT` expects `{ name, description }[]` but `getTypeASkillNames` only returns names - passing `description: ""` here is a known simplification. If descriptions turn out to matter for extraction quality during Task 14's manual pass, add a `getTypeASkills` (full rows) query to Task 6's `db.ts` and swap it in here; don't speculatively build it now.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- lib/skills/loop.test.ts`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/skills/loop.ts lib/skills/loop.test.ts
git commit -m "Add two-step skill-gap analysis orchestration"
```

---

## Task 12: `app/api/skill-gap/route.ts`

**Files:**
- Create: `app/api/skill-gap/route.ts`

**Interfaces:**
- Consumes: `runSkillGapAnalysis`, `SkillGapEvent` (Task 11); `getDb` (Task 6); `getSession` (`lib/session.ts`, existing); `getRateLimiter` (`lib/rateLimit/`, existing); `getClientIp` (`lib/getClientIp.ts`, existing).
- Produces: a POST endpoint at `/api/skill-gap`, SSE-streamed, matching `app/api/agent/route.ts`'s response shape/headers exactly so the client-side SSE parser (Task 13) can reuse the same parsing logic already proven in `ResultsPanel.tsx`.

No dedicated test file - this route is a thin composition of already-tested pieces (`runSkillGapAnalysis`, `getSession`, `getRateLimiter`) plus streaming plumbing identical to the untested `app/api/agent/route.ts`. It's verified by the Task 14 manual end-to-end pass, consistent with how the existing route is verified.

- [ ] **Step 1: Write the route**

```typescript
import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSession } from "@/lib/session";
import { getRateLimiter } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/getClientIp";
import { runSkillGapAnalysis } from "@/lib/skills/loop";
import { getDb } from "@/lib/skills/db/client";
import type { Job } from "@/lib/tools/types";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session.authenticated) {
    return new Response(JSON.stringify({ error: "Not authenticated" }), {
      status: 401,
    });
  }

  const limiter = getRateLimiter();
  const ip = getClientIp(req);
  const limitResult = await limiter.check(ip);
  if (!limitResult.allowed) {
    return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: limitResult.retryAfterSeconds
        ? { "Retry-After": String(limitResult.retryAfterSeconds) }
        : undefined,
    });
  }

  const body = await req.json();
  const resume: string = typeof body.resume === "string" ? body.resume : "";
  const job = body.job as Pick<Job, "title" | "description">;

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const db = getDb();

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        for await (const event of runSkillGapAnalysis(client, db, resume, job)) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
          );
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/skill-gap/route.ts
git commit -m "Add streamed skill-gap analysis API route"
```

---

## Task 13: `SkillGapPanel.tsx` wired into `JobCard.tsx`

**Files:**
- Create: `components/SkillGapPanel.tsx`
- Modify: `components/JobCard.tsx`

**Interfaces:**
- Consumes: `RankedJobWithDescription` (Task 1); the `/api/skill-gap` SSE stream (Task 12), parsed the same way `ResultsPanel.tsx` already parses `/api/agent`'s stream.

- [ ] **Step 1: Write `SkillGapPanel.tsx`**

```typescript
"use client";

import { useState } from "react";
import type { RankedJobWithDescription } from "@/lib/agent/loop";
import type { SkillGapEvent, SkillGapResult } from "@/lib/skills/loop";

const confidenceStyles: Record<string, string> = {
  High: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200",
  Medium: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200",
  Low: "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200",
};

export function SkillGapPanel({
  job,
  resume,
}: {
  job: RankedJobWithDescription;
  resume: string;
}) {
  const [state, setState] = useState<"idle" | "loading" | "result" | "error">(
    "idle"
  );
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<SkillGapResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function analyze() {
    setState("loading");
    setError(null);
    setProgress(null);

    try {
      const res = await fetch("/api/skill-gap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume, job }),
      });

      if (!res.ok || !res.body) {
        setState("error");
        setError("Skill gap analysis request failed");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          if (!chunk.startsWith("data: ")) continue;
          const event: SkillGapEvent = JSON.parse(chunk.slice("data: ".length));
          if (event.type === "progress") {
            setProgress(event.message);
          } else if (event.type === "result") {
            setResult(event.data);
            setState("result");
          } else if (event.type === "error") {
            setError(event.message);
            setState("error");
          }
        }
      }
    } catch {
      setState("error");
      setError("Skill gap analysis request failed");
    }
  }

  if (state === "idle") {
    return (
      <button
        type="button"
        onClick={analyze}
        className="mt-3 w-full rounded-lg border border-slate-200 py-2 text-xs font-medium text-slate-600 transition hover:border-brand hover:text-brand"
      >
        Analyze skill gap
      </button>
    );
  }

  return (
    <div className="mt-3 border-t border-slate-100 pt-3 text-sm">
      {state === "loading" && (
        <p className="text-slate-500">{progress ?? "Starting analysis..."}</p>
      )}

      {state === "error" && (
        <p className="text-red-600">{error}</p>
      )}

      {state === "result" && result && (
        <div className="space-y-3">
          {result.matched.length > 0 && (
            <div>
              <p className="mb-1 font-medium text-slate-700">Skills you have</p>
              <ul className="space-y-1">
                {result.matched.map((m) => (
                  <li key={m.requiredSkill} className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${confidenceStyles[m.confidence]}`}
                    >
                      {m.confidence}
                    </span>
                    <span className="text-slate-700">
                      {m.requiredSkill}
                      {m.matchedBy !== m.requiredSkill && ` (via ${m.matchedBy})`}
                    </span>
                    {m.confidence !== "High" && (
                      <span className="text-xs italic text-slate-400">
                        needs confirmation
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.typeAGapsOrdered.length > 0 && (
            <div>
              <p className="mb-1 font-medium text-slate-700">
                Learn these first
              </p>
              <ol className="list-decimal space-y-1 pl-4">
                {result.typeAGapsOrdered.map((skill) => (
                  <li key={skill} className="text-slate-700">
                    {skill}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {result.typeBGaps.length > 0 && (
            <div>
              <p className="mb-1 font-medium text-slate-700">Also missing</p>
              <ul className="space-y-1">
                {result.typeBGaps.map((gap) => (
                  <li key={gap.skill} className="flex items-center gap-2 text-slate-700">
                    {gap.skill}
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
                      {gap.importance}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.matched.length === 0 &&
            result.typeAGapsOrdered.length === 0 &&
            result.typeBGaps.length === 0 && (
              <p className="text-slate-500">
                This posting doesn&apos;t have enough detail to analyze.
              </p>
            )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire it into `JobCard.tsx`**

`JobCard` currently only receives `job`. It needs the `resume` text too, to pass through to `SkillGapPanel`. Update the props and render:

```typescript
export function JobCard({
  job,
  resume,
}: {
  job: RankedJobWithDescription;
  resume: string;
}) {
```

Add the import at the top:

```typescript
import { SkillGapPanel } from "./SkillGapPanel";
```

Add `<SkillGapPanel job={job} resume={resume} />` right before the closing `</div>` of the outermost card `div` (after the existing source/view-posting row).

- [ ] **Step 3: Pass `resume` down from `ResultsPanel.tsx`**

`ResultsPanel` has `resume` in scope inside `handleSubmit` but doesn't currently keep it in state for later rendering. Add state and thread it through:

```typescript
  const [lastResume, setLastResume] = useState<string>("");
```

Inside `handleSubmit`, alongside the existing `setLastCriteria(criteria);` line:

```typescript
    setLastResume(resume);
```

Where `<JobCard key={...} job={job} />` is rendered, change to:

```typescript
            <JobCard key={`${job.url}-${i}`} job={job} resume={lastResume} />
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add components/SkillGapPanel.tsx components/JobCard.tsx components/ResultsPanel.tsx
git commit -m "Add skill gap analysis UI to job cards"
```

---

## Task 14: Local DB setup and manual end-to-end verification

This task has no code changes - it's the project's standing rule (verify features the way an actual end user would trigger them) applied to a feature that, uniquely among this codebase's features, needs a provisioned database first.

- [ ] **Step 1: Provision a Neon database**

Create a free Neon project (or a Vercel Postgres database from the Vercel dashboard, which is Neon under the hood) and copy its connection string.

- [ ] **Step 2: Configure local env**

Add the connection string to `.env.local` (already git-ignored) as `DATABASE_URL=...`.

- [ ] **Step 3: Run the migration**

Run: `npx drizzle-kit push`
Expected: the four tables are created in the Neon database.

- [ ] **Step 4: Seed the curated data**

Run: `npm run db:seed`
Expected: console output confirming the counts from Task 5's script (matches Task 4's `TYPE_A_SKILLS`/`TYPE_A_DEPENDENCIES`/`EQUIVALENCE_GROUPS` lengths).

- [ ] **Step 5: Run the app locally and verify the full flow**

Run: `npm run dev`, open `http://localhost:3000`, run a real job search with a real resume (paste one with genuine course/project history), then click "Analyze skill gap" on a real result. Verify:
- Progress messages appear while the analysis runs.
- The result shows at least one of the three sections (matched / Type-A gaps / Type-B gaps) with content that plausibly matches the resume and job posting.
- Any Low-confidence matches are visually flagged "needs confirmation."
- Clicking "Analyze skill gap" on a second card works independently of the first (per-card state, no cross-card interference).
- A job with a very thin description (try one from RemoteOK, which tends to have short postings) shows the "doesn't have enough detail to analyze" message rather than a broken/empty state, or degrades gracefully if it still finds a few requirements.

- [ ] **Step 6: Add `DATABASE_URL` to Vercel Production env vars**

In the Vercel dashboard, add `DATABASE_URL` to the Production environment (same place `SITE_PASSWORD` was added earlier), then trigger a redeploy so the live site picks it up. Also run `npm run db:seed` once against production's `DATABASE_URL` (or point `drizzle-kit push` + the seed script at it directly) so the live tables exist and are populated before the feature is used in production.
