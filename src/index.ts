import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Env } from "./corpus.js";
import { buildServer } from "./server.js";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID",
};

function withCors(resp: Response): Response {
  const merged = new Response(resp.body, resp);
  for (const [k, v] of Object.entries(CORS_HEADERS)) merged.headers.set(k, v);
  return merged;
}

const INFO_BODY = JSON.stringify(
  {
    name: "genai-security-advisor-mcp",
    description:
      "Remote MCP server for the OWASP GenAI Security Project's curated corpus. " +
      "Companion to the genai-security-advisor Claude Code skill.",
    protocol: "Model Context Protocol (Streamable HTTP, stateless)",
    mcp_endpoint: "/mcp",
    repo: "https://github.com/GenAI-Security-Project/GenAI-Security-Advisor-MCP",
    corpus_source: "https://github.com/GenAI-Security-Project/GenAI-Security-Advisor",
    license: "Apache-2.0 (this server's code -- vendored corpus content keeps its own license, see each resource)",
  },
  null,
  2,
);

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }));
    }

    if (url.pathname === "/" && request.method === "GET") {
      return withCors(
        new Response(INFO_BODY, { headers: { "Content-Type": "application/json" } }),
      );
    }

    if (url.pathname === "/mcp") {
      try {
        const server = buildServer(env, ctx);
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: undefined, // stateless: no session tracking, no Durable Objects
          enableJsonResponse: true, // plain JSON responses for simple request/response tool calls
        });
        await server.connect(transport);
        const resp = await transport.handleRequest(request);
        ctx.waitUntil(server.close());
        return withCors(resp);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return withCors(
          new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
    }

    return withCors(new Response("Not found", { status: 404 }));
  },
};
