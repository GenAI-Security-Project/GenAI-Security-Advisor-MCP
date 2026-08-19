import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  Env,
  ManifestResource,
  extractedTextPath,
  fetchRawFile,
  filesUnderPath,
  getManifest,
  getSourceRevision,
  getTree,
  isReadablePath,
  isSafeCorpusPath,
  rawUrl,
} from "./corpus.js";

const STATUS_VALUES = ["current", "draft", "superseded", "linked"] as const;
const MAX_SEARCH_MATCHES = 20;
const SNIPPET_RADIUS = 160;

function json(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

function resourceSummary(r: ManifestResource) {
  return {
    id: r.id,
    title: r.title,
    initiative: r.initiative,
    version: r.version,
    status: r.status,
    format: r.format,
    license: r.license,
    notes: r.notes,
  };
}

export function buildServer(env: Env, ctx: ExecutionContext): McpServer {
  const server = new McpServer(
    {
      name: "genai-security-advisor-mcp",
      version: "0.1.0",
    },
    {
      instructions:
        "Browses the OWASP GenAI Security Project's curated corpus (companion to the " +
        "genai-security-advisor skill). All content is read live from the " +
        `${env.SOURCE_REPO} GitHub repo at query time. Each request resolves ` +
        `${env.SOURCE_REF} to a commit SHA once and reads everything from that pinned ` +
        "revision, so every field in a result is internally consistent and citable. " +
        "Every result includes source_revision, the exact commit SHA of " +
        `${env.SOURCE_REF} the answer was read from (see get_corpus_revision for ` +
        "just the revision). If the revision cannot be resolved (e.g. GitHub API " +
        "rate limit or outage), the server fails closed and returns an error " +
        "rather than serving content that cannot be pinned to a revision. " +
        "Start with list_resources or list_initiatives, then get_resource for a specific " +
        "document's metadata and file list, get_file to read a specific text file's " +
        "contents, or search_corpus for a keyword search across markdown/JSON resources. " +
        "PDFs and spreadsheets are not text-extracted here -- get_resource returns a " +
        "raw_url for those so you can fetch and read them directly. " +
        "Vendored content is third-party (mostly CC BY-SA 4.0, see each resource's " +
        "license field) -- this server's own code is Apache-2.0, but that grant does not " +
        "extend to the corpus content it serves.",
    },
  );

  server.registerTool(
    "list_resources",
    {
      title: "List corpus resources",
      description:
        "List catalog entries from the corpus MANIFEST, optionally filtered by status " +
        "(defaults to 'current' -- the only status most questions should use), initiative, " +
        "or format. Returns metadata only, not content -- use get_resource for a specific " +
        "entry's detail.",
      inputSchema: {
        status: z
          .enum(STATUS_VALUES)
          .optional()
          .describe("Defaults to 'current'. Pass 'all' via omitting this filter only if you explicitly need draft/superseded/linked entries too -- otherwise leave unset."),
        initiative: z
          .string()
          .optional()
          .describe("e.g. 'llm-top10', 'agentic-top10', 'data-security', 'mcp-security', 'red-teaming', 'governance', 'incident-response'"),
        format: z.string().optional().describe("e.g. 'markdown', 'pdf', 'json', 'mixed'"),
      },
    },
    async ({ status, initiative, format }) => {
      const sha = await getSourceRevision(env, ctx);
      const manifest = await getManifest(env, ctx, sha);
      let resources = manifest.resources;
      resources = resources.filter((r) => r.status === (status ?? "current"));
      if (initiative) resources = resources.filter((r) => r.initiative === initiative);
      if (format) resources = resources.filter((r) => r.format === format);
      return json({
        count: resources.length,
        resources: resources.map(resourceSummary),
        source_revision: sha,
      });
    },
  );

  server.registerTool(
    "list_initiatives",
    {
      title: "List corpus initiatives",
      description:
        "List the distinct initiative categories in the corpus (llm-top10, agentic-top10, " +
        "data-security, mcp-security, red-teaming, governance, incident-response) with a " +
        "count of current resources in each. Use this to orient before drilling into " +
        "list_resources with a specific initiative filter.",
      inputSchema: {},
    },
    async () => {
      const sha = await getSourceRevision(env, ctx);
      const manifest = await getManifest(env, ctx, sha);
      const counts = new Map<string, { current: number; total: number }>();
      for (const r of manifest.resources) {
        const c = counts.get(r.initiative) ?? { current: 0, total: 0 };
        c.total += 1;
        if (r.status === "current") c.current += 1;
        counts.set(r.initiative, c);
      }
      return json({
        source_revision: sha,
        initiatives: Array.from(counts.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([initiative, c]) => ({ initiative, ...c })),
      });
    },
  );

  server.registerTool(
    "get_resource",
    {
      title: "Get a resource's metadata and files",
      description:
        "Look up one MANIFEST entry by id (from list_resources) and return its full " +
        "metadata. For markdown/json resources, also lists the underlying file(s) with a " +
        "raw_url for each -- use get_file to read a specific one. For pdf/mixed resources, " +
        "returns a raw_url to fetch the binary directly, plus (when available) a " +
        "text_extract_url -- an unreviewed, offline OCR/text-extraction sidecar meant only " +
        "for quick skimming or search, never for precise quoting (tables/layout don't " +
        "survive extraction reliably; always fall back to raw_url for anything that needs " +
        "to be accurate). For status:'linked' resources, there is no vendored copy -- only " +
        "source_url is returned, and you should fetch that directly and say plainly it's " +
        "live content, not vendored.",
      inputSchema: {
        id: z.string().describe("Resource id, e.g. 'llm-top10-2026' (see list_resources)"),
      },
    },
    async ({ id }) => {
      const sha = await getSourceRevision(env, ctx);
      const manifest = await getManifest(env, ctx, sha);
      const resource = manifest.resources.find((r) => r.id === id);
      if (!resource) {
        return errorResult(
          `No resource with id '${id}'. Call list_resources to see valid ids.`,
        );
      }

      if (resource.status === "linked" || !resource.path) {
        return json({
          ...resourceSummary(resource),
          vendored: false,
          source_url: resource.source_url,
          source_repo: resource.source_repo,
          source_revision: sha,
        });
      }

      const tree = await getTree(env, ctx, sha);
      const treePaths = new Set(tree.filter((e) => e.type === "blob").map((e) => e.path));
      // Only report files that actually exist in the pinned tree. A manifest
      // path that drifted out of the repo (or a single-file resource whose
      // path isn't a blob) would otherwise produce raw_urls that 404.
      const files = filesUnderPath(resource.path, tree).filter((path) => treePaths.has(path));
      return json({
        ...resourceSummary(resource),
        vendored: true,
        source_revision: sha,
        files: files.map((path) => {
          const extractedPath = extractedTextPath(path);
          const hasExtract = extractedPath !== null && treePaths.has(extractedPath);
          return {
            path,
            raw_url: rawUrl(path, env, sha),
            readable_via_get_file: isReadablePath(path),
            ...(hasExtract && {
              text_extract_url: rawUrl(extractedPath as string, env, sha),
              text_extract_warning:
                "Unreviewed automated extraction for search/skimming only -- not citable, use raw_url for anything that needs to be accurate.",
            }),
          };
        }),
      });
    },
  );

  server.registerTool(
    "get_file",
    {
      title: "Read a corpus text file",
      description:
        "Read the raw text content of one file under corpus/ (markdown, yaml, json, or " +
        "txt only -- PDFs and spreadsheets aren't supported here, use the raw_url from " +
        "get_resource instead). The path must be one returned by get_resource's files " +
        "list.",
      inputSchema: {
        path: z.string().describe("A repo-relative path under corpus/, e.g. 'corpus/llm-top10/2026/LLM01_PromptInjection.md'"),
      },
    },
    async ({ path }) => {
      if (!isSafeCorpusPath(path)) {
        return errorResult("Invalid path: must be a plain repo-relative path under corpus/ with no '..' segments, no absolute or protocol-relative forms, no backslashes, no percent-encoded characters, and no control characters.");
      }
      if (!isReadablePath(path)) {
        return errorResult(
          "This file type isn't readable via get_file (only .md/.yaml/.yml/.json/.txt). " +
            "Use get_resource to find its raw_url and fetch it directly.",
        );
      }
      const sha = await getSourceRevision(env, ctx);
      const tree = await getTree(env, ctx, sha);
      const exists = tree.some((e) => e.type === "blob" && e.path === path);
      if (!exists) {
        return errorResult(`'${path}' was not found in ${env.SOURCE_REPO}@${env.SOURCE_REF}.`);
      }
      const text = await fetchRawFile(path, env, ctx, sha);
      return {
        content: [{ type: "text" as const, text }],
        structuredContent: { source_revision: sha },
      };
    },
  );

  server.registerTool(
    "search_corpus",
    {
      title: "Search the corpus",
      description:
        "Case-insensitive substring search across vendored markdown/json content, " +
        "unreviewed offline text extractions of PDF content (see the warning field on " +
        "those matches -- don't quote them, they're for locating the right document), and " +
        "every resource's title/notes. Returns matches with a short snippet. For a " +
        "thorough or precise read of a PDF resource, use get_resource to get its raw_url " +
        "and fetch it directly instead.",
      inputSchema: {
        query: z.string().min(2).describe("Search term, case-insensitive substring match"),
        status: z
          .enum(STATUS_VALUES)
          .optional()
          .describe("Defaults to 'current'"),
      },
    },
    async ({ query, status }) => {
      const sha = await getSourceRevision(env, ctx);
      const manifest = await getManifest(env, ctx, sha);
      const needle = query.toLowerCase();
      const targetStatus = status ?? "current";
      const resources = manifest.resources.filter((r) => r.status === targetStatus);

      const matches: Array<{
        resource_id: string;
        title: string;
        file?: string;
        field: string;
        snippet: string;
        warning?: string;
      }> = [];

      const tree = await getTree(env, ctx, sha);
      const treePaths = new Set(tree.filter((e) => e.type === "blob").map((e) => e.path));
      const EXTRACT_WARNING =
        "From an unreviewed automated PDF text extraction -- for locating the right document only, do not quote; fetch the source PDF via get_resource for accurate text.";

      for (const r of resources) {
        if (matches.length >= MAX_SEARCH_MATCHES) break;

        const metaText = `${r.title}\n${r.notes ?? ""}`;
        const metaIdx = metaText.toLowerCase().indexOf(needle);
        if (metaIdx !== -1) {
          matches.push({
            resource_id: r.id,
            title: r.title,
            field: "title/notes",
            snippet: snippetAround(metaText, metaIdx, needle.length),
          });
        }

        if (!r.path) continue;

        // Directly readable text content (markdown/json).
        if (r.format === "markdown" || r.format === "json") {
          const files = filesUnderPath(r.path, tree).filter(isReadablePath);
          for (const file of files) {
            if (matches.length >= MAX_SEARCH_MATCHES) break;
            let text: string;
            try {
              text = await fetchRawFile(file, env, ctx, sha);
            } catch {
              continue;
            }
            const idx = text.toLowerCase().indexOf(needle);
            if (idx !== -1) {
              matches.push({
                resource_id: r.id,
                title: r.title,
                file,
                field: "content",
                snippet: snippetAround(text, idx, needle.length),
              });
            }
          }
        }

        // PDF content, via its offline-extracted sidecar (if one exists).
        if (r.format === "pdf" || r.format === "mixed") {
          const pdfFiles = filesUnderPath(r.path, tree).filter((p) =>
            p.toLowerCase().endsWith(".pdf"),
          );
          for (const pdfPath of pdfFiles) {
            if (matches.length >= MAX_SEARCH_MATCHES) break;
            const extractedPath = extractedTextPath(pdfPath);
            if (!extractedPath || !treePaths.has(extractedPath)) continue;
            let text: string;
            try {
              text = await fetchRawFile(extractedPath, env, ctx, sha);
            } catch {
              continue;
            }
            const idx = text.toLowerCase().indexOf(needle);
            if (idx !== -1) {
              matches.push({
                resource_id: r.id,
                title: r.title,
                file: pdfPath,
                field: "content (extracted)",
                snippet: snippetAround(text, idx, needle.length),
                warning: EXTRACT_WARNING,
              });
            }
          }
        }
      }

      return json({
        query,
        status: targetStatus,
        count: matches.length,
        matches,
        source_revision: sha,
      });
    },
  );

  server.registerTool(
    "get_corpus_revision",
    {
      title: "Get the exact corpus revision",
      description:
        "Return the exact commit SHA of the source repo ref (SOURCE_REF) that this server " +
        "is currently serving answers from, with a GitHub URL for the commit. Use this to " +
        "record which revision a claim or answer was read from, or to detect when the " +
        "served corpus has changed between calls. Every other tool's result also carries " +
        "the same source_revision field, so this is only needed when you want the revision " +
        "without a resource lookup or search.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const sha = await getSourceRevision(env, ctx);
      return json({
        source_repo: env.SOURCE_REPO,
        source_ref: env.SOURCE_REF,
        source_revision: sha,
        commit_url: `https://github.com/${env.SOURCE_REPO}/commit/${sha}`,
      });
    },
  );

  return server;
}

function snippetAround(text: string, index: number, matchLength: number): string {
  const start = Math.max(0, index - SNIPPET_RADIUS);
  const end = Math.min(text.length, index + matchLength + SNIPPET_RADIUS);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return prefix + text.slice(start, end).replace(/\s+/g, " ").trim() + suffix;
}
