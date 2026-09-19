import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getRateLimiter } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/getClientIp";
import { runAgentLoop } from "@/lib/agent/loop";
import type { SearchCriteria } from "@/lib/tools/types";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  // TEMP: auth check disabled while login is broken - revert (restore the
  // session.authenticated check below) once SITE_PASSWORD login works again.

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
  const criteria: SearchCriteria = {
    keywords: Array.isArray(body.keywords) ? body.keywords : [],
    location: typeof body.location === "string" ? body.location : "",
    remoteOnly: Boolean(body.remoteOnly),
  };

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        for await (const event of runAgentLoop(client, resume, criteria)) {
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
