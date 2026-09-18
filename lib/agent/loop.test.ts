import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { runAgentLoop, type AgentEvent } from "./loop";

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
        description: "",
      },
    ],
  }),
}));
vi.mock("../tools/searchRemoteOK", () => ({
  searchRemoteOK: vi.fn().mockResolvedValue({ source: "remoteok", jobs: [] }),
}));
vi.mock("../tools/searchRemotive", () => ({
  searchRemotive: vi.fn().mockResolvedValue({ source: "remotive", jobs: [] }),
}));

async function collect(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

function fakeClient(
  responses: Anthropic.Message[]
): Anthropic {
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

const validRankedJob = {
  title: "Backend Engineer",
  company: "Acme",
  location: "Remote",
  url: "https://example.com/1",
  source: "adzuna",
  score: 90,
  reasoning: "Good fit.",
};

describe("runAgentLoop", () => {
  it("calls a search tool, then yields the submitted rankings", async () => {
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
    expect(resultEvent).toBeDefined();
    expect(resultEvent).toMatchObject({
      type: "result",
      data: { jobs: [validRankedJob] },
    });
    expect(events.some((e) => e.type === "progress")).toBe(true);
  });

  it("yields an error when Claude returns malformed rankings", async () => {
    const client = fakeClient([
      {
        content: [
          {
            type: "tool_use",
            id: "call_1",
            name: "submit_rankings",
            input: { jobs: [{ title: "missing other required fields" }] },
          },
        ],
      } as unknown as Anthropic.Message,
    ]);

    const events = await collect(
      runAgentLoop(client, "resume text", {
        keywords: [],
        location: "",
        remoteOnly: false,
      })
    );

    expect(events.at(-1)).toMatchObject({ type: "error" });
  });

  it("yields an error when the Claude API call throws", async () => {
    const client = {
      messages: {
        create: vi.fn().mockRejectedValue(new Error("api down")),
      },
    } as unknown as Anthropic;

    const events = await collect(
      runAgentLoop(client, "resume text", {
        keywords: [],
        location: "",
        remoteOnly: false,
      })
    );

    expect(events).toEqual([{ type: "error", message: "api down" }]);
  });

  it("yields a clear error when the response is cut off by max_tokens", async () => {
    const client = fakeClient([
      {
        stop_reason: "max_tokens",
        content: [
          {
            type: "tool_use",
            id: "call_1",
            name: "submit_rankings",
            input: {},
          },
        ],
      } as unknown as Anthropic.Message,
    ]);

    const events = await collect(
      runAgentLoop(client, "resume text", {
        keywords: [],
        location: "",
        remoteOnly: false,
      })
    );

    expect(events).toEqual([
      {
        type: "error",
        message:
          "Agent response was cut off before completing - try a shorter resume or narrower search.",
      },
    ]);
  });

  it("forces submit_rankings on the final round via tool_choice", async () => {
    // Never submits on its own, so the loop must run all MAX_TOOL_ROUNDS
    // rounds and we can inspect what the final, forced call requested.
    const create = vi.fn().mockResolvedValue({
      content: [
        {
          type: "tool_use",
          id: "call_search",
          name: "search_adzuna",
          input: { keywords: [], location: "", remoteOnly: false },
        },
      ],
    } as unknown as Anthropic.Message);
    const client = { messages: { create } } as unknown as Anthropic;

    await collect(
      runAgentLoop(client, "resume text", {
        keywords: [],
        location: "",
        remoteOnly: false,
      })
    );

    expect(create).toHaveBeenCalledTimes(6);
    const lastCallArgs = create.mock.calls.at(-1)![0];
    expect(lastCallArgs.tool_choice).toEqual({
      type: "tool",
      name: "submit_rankings",
    });
  });
});
