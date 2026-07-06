import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const TOOLS: Anthropic.Tool[] = [
  {
    name: "get_rankings",
    description:
      "Get current TXL power rankings for all teams. Returns team name, manager, rank, hittingScore, pitchingScore, totalScore, ERA, OPS, record, streak, moves, playoffPct, pointsFor, pointsAgainst.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_player_leaderboard",
    description:
      "Get individual player TXL scores for every rostered player. Returns player name, fantasy team, manager, position, type (hitter/pitcher), txlScore, draftRound, keeper status, and acquisitionType (DRAFT/ADD/TRADE).",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_player_log",
    description:
      "Get a specific player's daily raw fantasy point log since a given date. Useful for checking how a player has performed over a date range. Points are raw ESPN appliedTotal regardless of sit/start status.",
    input_schema: {
      type: "object" as const,
      properties: {
        player: {
          type: "string",
          description:
            "Player full name, e.g. 'Luis García Jr.' — accent-insensitive matching is supported",
        },
        since: {
          type: "string",
          description: "Start date in YYYY-MM-DD format, e.g. '2026-06-26'",
        },
      },
      required: ["player", "since"],
    },
  },
  {
    name: "get_snapshots",
    description:
      "Get historical daily snapshot data showing how team scores changed over time. Each snapshot contains snapshot_date and an array of team objects with totalScore, hittingScore, pitchingScore, rank, record, dailyPoints, etc. Defaults to last 30 days.",
    input_schema: {
      type: "object" as const,
      properties: {
        from: {
          type: "string",
          description: "Start date YYYY-MM-DD (optional)",
        },
        to: {
          type: "string",
          description: "End date YYYY-MM-DD (optional)",
        },
      },
      required: [],
    },
  },
  {
    name: "get_props",
    description:
      "Get season props/awards: HR leaders, K (strikeout) leaders, weekly top 10 highest-scoring weeks, and the bad luck trophy (teams with worst record relative to points scored).",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
];

async function callTool(
  name: string,
  input: Record<string, string>,
  baseUrl: string
): Promise<string> {
  let url: string;
  switch (name) {
    case "get_rankings":
      url = `${baseUrl}/api/rankings`;
      break;
    case "get_player_leaderboard":
      url = `${baseUrl}/api/player-leaderboard`;
      break;
    case "get_player_log": {
      const params = new URLSearchParams();
      if (input.player) params.set("player", input.player);
      if (input.since) params.set("since", input.since);
      url = `${baseUrl}/api/player-log?${params}`;
      break;
    }
    case "get_snapshots": {
      const params = new URLSearchParams();
      if (input.from) params.set("from", input.from);
      if (input.to) params.set("to", input.to);
      url = `${baseUrl}/api/snapshots?${params}`;
      break;
    }
    case "get_props":
      url = `${baseUrl}/api/props`;
      break;
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }

  const res = await fetch(url);
  if (!res.ok) return JSON.stringify({ error: `API error: ${res.status}` });
  return JSON.stringify(await res.json());
}

export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const { message } = await request.json();
  if (!message || typeof message !== "string") {
    return new Response(
      JSON.stringify({ error: "Missing 'message' in request body" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const origin = new URL(request.url).origin;

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: message },
  ];

  const systemPrompt = `You are TXL Bot, the AI assistant for the TXL Fantasy Baseball league's power rankings site. Today's date is ${new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" })}.

You have access to tools that query live league data. Use them to answer questions about team standings, player performance, scoring trends, and more.

The league uses a custom TXL scoring system with hitting and pitching multipliers. Key stats:
- Hitting: R, 1B, 2B(x2), 3B(x3), HR(x4), TB, RBI, BB, K(-1), HBP, SB, CS(-1), CYC(x5)
- Pitching: Outs(IP), H(-1), ER(-1), BB(-1), HB(-1), K(x2), QS(x5), CG(x5), SO(x10), W(x3), L(-3), SV(x3), BS(-2), HD

There are 12 teams in the league. Keep responses concise and conversational. Use the data from tools to give accurate answers — don't guess stats.`;

  try {
    let response = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 1024,
      system: systemPrompt,
      tools: TOOLS,
      messages,
    });

    let iterations = 0;
    while (response.stop_reason === "tool_use" && iterations < 5) {
      iterations++;

      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );

      messages.push({ role: "assistant", content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const tool of toolUseBlocks) {
        const result = await callTool(
          tool.name,
          tool.input as Record<string, string>,
          origin
        );
        toolResults.push({
          type: "tool_result",
          tool_use_id: tool.id,
          content: result,
        });
      }

      messages.push({ role: "user", content: toolResults });

      response = await client.messages.create({
        model: "claude-sonnet-5",
        max_tokens: 1024,
        system: systemPrompt,
        tools: TOOLS,
        messages,
      });
    }

    const textBlock = response.content.find(
      (b): b is Anthropic.TextBlock => b.type === "text"
    );

    return new Response(
      JSON.stringify({ reply: textBlock?.text ?? "No response generated." }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Chat API error:", err);
    return new Response(
      JSON.stringify({ error: "Failed to generate response" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
