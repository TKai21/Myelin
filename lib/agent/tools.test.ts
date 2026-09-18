import { describe, expect, it } from "vitest";
import { AGENT_TOOLS } from "./tools";

describe("AGENT_TOOLS", () => {
  it("defines exactly the four expected tools", () => {
    const names = AGENT_TOOLS.map((t) => t.name).sort();
    expect(names).toEqual([
      "search_adzuna",
      "search_remoteok",
      "search_remotive",
      "submit_rankings",
    ]);
  });

  it("requires keywords, location, and remoteOnly on search_adzuna", () => {
    const tool = AGENT_TOOLS.find((t) => t.name === "search_adzuna")!;
    const schema = tool.input_schema as { required?: string[] };
    expect(schema.required).toEqual(
      expect.arrayContaining(["keywords", "location", "remoteOnly"])
    );
  });

  it("requires a jobs array on submit_rankings", () => {
    const tool = AGENT_TOOLS.find((t) => t.name === "submit_rankings")!;
    const schema = tool.input_schema as { required?: string[] };
    expect(schema.required).toEqual(["jobs"]);
  });

  it("marks the last tool for prompt caching", () => {
    const last = AGENT_TOOLS[AGENT_TOOLS.length - 1] as {
      cache_control?: { type: string };
    };
    expect(last.cache_control).toEqual({ type: "ephemeral" });
  });
});
