# GenAI Security Advisor -- MCP Server

A remote [Model Context Protocol](https://modelcontextprotocol.io) server that
lets any MCP-capable agent browse and read the OWASP GenAI Security Project's
curated corpus over HTTP. Companion to the
[`genai-security-advisor`](https://github.com/GenAI-Security-Project/GenAI-Security-Advisor)
Claude Code skill -- same corpus, different access pattern: the skill is for
an agent that already has this repo checked out locally; this server is for
an agent that doesn't, reachable at a public URL with no local install.

## Architecture

- **Hosting: Cloudflare Workers**, plain free tier. No Durable Objects, no
  KV, no D1 -- the only Workers feature in use is the built-in Cache API,
  which needs no binding or paid plan.
- **Stateless MCP over Streamable HTTP.** Every request is handled
  independently (`sessionIdGenerator: undefined` in the SDK's
  `WebStandardStreamableHTTPServerTransport`) -- no session state, no
  server-initiated notifications, no Durable Object required. This is the
  same pattern Cloudflare's own blog recommends for simple tool-calling
  servers: smaller bundle, scales to zero, nothing to provision.
- **No vendored data in this repo.** Every tool call reads
  [`GenAI-Security-Advisor`](https://github.com/GenAI-Security-Project/GenAI-Security-Advisor)'s
  `corpus/MANIFEST.yaml` and files live from GitHub at request time (via
  `raw.githubusercontent.com` and the Git Trees API), through Cloudflare's
  edge Cache API (1 hour TTL). The two repos can never drift out of sync --
  there's nothing to re-sync.

This means GitHub Pages/Codespaces were deliberately **not** used for the
serving layer: Pages is static-only (can't run the MCP protocol's
request/response handling), and Codespaces isn't built for always-on public
hosting (idle-stops, limited free compute hours). Cloudflare Workers' free
tier (100k requests/day) is the piece that makes this reachable at a stable
URL with no infrastructure to maintain.

## Tools

| Tool | Purpose |
|---|---|
| `list_resources` | Catalog entries, filterable by status/initiative/format |
| `list_initiatives` | Category overview with resource counts |
| `get_resource` | One resource's metadata + file list (or `source_url` for `linked` entries) |
| `get_file` | Read one text file's content (`.md`/`.yaml`/`.yml`/`.json`/`.txt` only) |
| `search_corpus` | Case-insensitive substring search across markdown/json content, extracted PDF text, and all titles/notes |

Nothing is text-extracted **server-side** -- the Workers free plan caps CPU
time at 10ms/request, far too little to parse a 50-140 page PDF live.
Instead, the source repo's `corpus/_extracted/` holds offline-generated
sidecar `.txt` files (via `scripts/extract_pdf_text.py` + a GitHub Action,
regenerated whenever a corpus PDF changes) -- `search_corpus` reads those,
and `get_resource` surfaces a `text_extract_url` alongside `raw_url` for any
PDF that has one. These extractions are explicitly **unreviewed and not
citable** (tables/layout don't survive `pypdf` reliably) -- every match and
every `get_resource` entry sourced from one carries a warning saying so.
Spreadsheets (`.xlsx`) still have no extraction at all -- `raw_url` only.

## Security model

- **Read-only.** No tool can write to GitHub or anywhere else. The server
  holds no write credentials at all.
- **No auth required to call this server.** The corpus is already public
  CC BY-SA 4.0 / OWASP-published content -- there's no secret to protect
  behind an API key. If usage ever needs throttling beyond Cloudflare's
  free-tier request cap, add a rate-limiting rule in the Cloudflare
  dashboard (Free plan zones support basic WAF rate-limiting rules) --
  no code change needed.
- **Path traversal is blocked at two layers** in `get_file`: syntactically
  (`corpus/` prefix required, `..` rejected) and by existence (the path must
  actually appear in the source repo's Git tree before it's fetched).
- **No secrets committed.** An optional `GITHUB_TOKEN` (read-only, to raise
  GitHub's unauthenticated rate limit if traffic ever warrants it) is set
  via `wrangler secret put`, never in this repo.
- **CORS is open** (`Access-Control-Allow-Origin: *`) since this is a public
  read API meant to be called from anywhere.

## Licensing

This server's code is Apache-2.0 (see `LICENSE`). That grant covers the code
in this repo only -- **not** the corpus content it serves at request time.
Vendored corpus content keeps its original license (mostly CC BY-SA 4.0);
see each resource's `license` field via `list_resources` / `get_resource`,
same as in the source repo's `MANIFEST.yaml`.

## Development

```bash
npm install
npm run typecheck     # tsc --noEmit
npm run dry-run       # bundle without deploying, no Cloudflare auth needed
npm run dev           # local dev server on :8787
```

Smoke test against a local `wrangler dev`:

```bash
curl -s -X POST http://localhost:8787/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Deploying

This step needs your own Cloudflare credentials, which this environment
does not have -- run it yourself:

```bash
npx wrangler login     # one-time interactive OAuth
npm run deploy
```

That publishes to `https://genai-security-advisor-mcp.<your-subdomain>.workers.dev`
by default. To put it at a custom domain instead, add a `routes` entry to
`wrangler.jsonc` (requires the zone to already be on Cloudflare) or set up a
Worker custom domain in the dashboard after the first deploy.

### Optional: raise the GitHub rate limit

Unauthenticated GitHub requests are capped at 60/hour per source IP, but
edge caching (1 hour TTL) means most traffic never re-hits GitHub after the
first request of each hour. If you outgrow that anyway, add a read-only
personal access token (no scopes needed for public repos):

```bash
npx wrangler secret put GITHUB_TOKEN
```

### Pointing at a fork or different ref

`SOURCE_REPO` and `SOURCE_REF` in `wrangler.jsonc`'s `vars` control which
repo/branch is read. Useful for testing against a fork before it's merged.

## Connecting an MCP client

Point any Streamable-HTTP-capable MCP client at
`https://<your-deployment>/mcp`. For Claude Code:

```bash
claude mcp add --transport http genai-security-advisor https://<your-deployment>/mcp
```
