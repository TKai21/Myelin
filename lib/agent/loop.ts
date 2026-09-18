import type Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT } from "./systemPrompt";
import { AGENT_TOOLS } from "./tools";
import { parseRankedResults, type RankedResults } from "./schema";
import { topByRelevance } from "../relevance";
import { searchAdzuna } from "../tools/searchAdzuna";
import { searchRemoteOK } from "../tools/searchRemoteOK";
import { searchRemotive } from "../tools/searchRemotive";
import type { SearchCriteria, ToolResult } from "../tools/types";

const MODEL = "claude-sonnet-5";
const MAX_TOOL_ROUNDS = 6;
const RESULTS_PER_SOURCE = 10;

export type AgentEvent =
  | { type: "progress"; message: string }
  | { type: "result"; data: RankedResults }
  | { type: "error"; message: string };

const TOOL_DISPATCH: Record<
  string,
  (criteria: SearchCriteria) => Promise<ToolResult>
> = {
  search_adzuna: searchAdzuna,
  search_remoteok: searchRemoteOK,
  search_remotive: searchRemotive,
};

async function runTool(
  name: string,
  input: Partial<SearchCriteria>,
  fallbackCriteria: SearchCriteria
): Promise<ToolResult> {
  const fn = TOOL_DISPATCH[name];
  const criteria: SearchCriteria = {
    keywords: input.keywords ?? fallbackCriteria.keywords,
    location: input.location ?? fallbackCriteria.location,
    remoteOnly: input.remoteOnly ?? fallbackCriteria.remoteOnly,
  };
  const result = await fn(criteria);
  return {
    ...result,
    jobs: topByRelevance(result.jobs, criteria.keywords, RESULTS_PER_SOURCE),
  };
}

export async function* runAgentLoop(
  client: Anthropic,
  resume: string,
  criteria: SearchCriteria
): AsyncGenerator<AgentEvent> {
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Resume:\n${resume}\n\nSearch criteria: ${JSON.stringify(
        criteria
      )}`,
    },
  ];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    // The last round forces submit_rankings so the loop always
    // terminates with a valid result instead of running out of turns.
    const isLastRound = round === MAX_TOOL_ROUNDS - 1;

    let response: Anthropic.Message;
    try {
      response = await client.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: [
          {
            type: "text",
            text: SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },
          },
        ],
        tools: AGENT_TOOLS,
        tool_choice: isLastRound
          ? { type: "tool", name: "submit_rankings" }
          : { type: "auto" },
        messages,
      } as Anthropic.MessageCreateParamsNonStreaming);
    } catch (err) {
      yield {
        type: "error",
        message: err instanceof Error ? err.message : "Claude API error",
      };
      return;
    }

    messages.push({ role: "assistant", content: response.content });

    const toolUses = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
    );

    const submit = toolUses.find((t) => t.name === "submit_rankings");
    if (submit) {
      try {
        const parsed = parseRankedResults(submit.input);
        yield { type: "result", data: parsed };
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

    if (toolUses.length === 0) {
      yield {
        type: "error",
        message: "Agent stopped without submitting rankings",
      };
      return;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const toolUse of toolUses) {
      yield { type: "progress", message: `Calling ${toolUse.name}...` };
      const result = await runTool(
        toolUse.name,
        toolUse.input as Partial<SearchCriteria>,
        criteria
      );
      yield {
        type: "progress",
        message: result.error
          ? `${toolUse.name} unavailable: ${result.error}`
          : `${toolUse.name} returned ${result.jobs.length} results`,
      };
      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: JSON.stringify(result),
      });
    }

    messages.push({ role: "user", content: toolResults });
  }

  yield {
    type: "error",
    message: "Agent exceeded max rounds without submitting rankings",
  };
}
