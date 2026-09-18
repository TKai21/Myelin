import type Anthropic from "@anthropic-ai/sdk";

const SEARCH_CRITERIA_SCHEMA = {
  type: "object" as const,
  properties: {
    keywords: {
      type: "array",
      items: { type: "string" },
      description:
        'Keywords/job title terms to search for, e.g. ["backend", "engineer"]',
    },
    location: {
      type: "string",
      description:
        'Free-text location, e.g. "San Francisco", or "" for no preference',
    },
    remoteOnly: {
      type: "boolean",
      description: "Whether to restrict results to remote roles",
    },
  },
  required: ["keywords", "location", "remoteOnly"],
};

export const AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: "search_adzuna",
    description:
      "Search Adzuna's general job board (US listings, broad coverage across industries).",
    input_schema: SEARCH_CRITERIA_SCHEMA,
  },
  {
    name: "search_remoteok",
    description:
      "Fetch recent remote job listings from RemoteOK. Takes no meaningful filter arguments - it always returns recent postings, which are then relevance-filtered before you see them.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "search_remotive",
    description: "Search Remotive's remote job board by keyword.",
    input_schema: SEARCH_CRITERIA_SCHEMA,
  },
  {
    name: "submit_rankings",
    description:
      "Submit the final ranked list of jobs. Call this exactly once, after scoring all deduplicated jobs against the resume.",
    input_schema: {
      type: "object",
      properties: {
        jobs: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              company: { type: "string" },
              location: { type: "string" },
              url: { type: "string" },
              source: {
                type: "string",
                enum: ["adzuna", "remoteok", "remotive"],
              },
              score: { type: "number" },
              reasoning: { type: "string" },
            },
            required: [
              "title",
              "company",
              "location",
              "url",
              "source",
              "score",
              "reasoning",
            ],
          },
        },
      },
      required: ["jobs"],
    },
    // Placed on the last tool so the cached prefix covers all tool
    // definitions (they're static across every turn of the loop).
    cache_control: { type: "ephemeral" },
  } as Anthropic.Tool & { cache_control: { type: "ephemeral" } },
];
