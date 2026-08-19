// Live access to the GenAI-Security-Advisor corpus on GitHub.
//
// Nothing here is vendored into this repo -- every read goes to GitHub at
// request time (through the Cache API) so this server always reflects the
// upstream corpus without a manual re-sync step.

import yaml from "js-yaml";

export interface Env {
  SOURCE_REPO: string; // "GenAI-Security-Project/GenAI-Security-Advisor"
  SOURCE_REF: string; // "main"
  GITHUB_TOKEN?: string; // optional read-only PAT to raise GitHub's rate limit
}

export interface ManifestResource {
  id: string;
  title: string;
  initiative: string;
  version: string;
  status: "current" | "draft" | "superseded" | "linked";
  format: string;
  license: string;
  path?: string | null;
  source_repo?: string;
  source_path?: string;
  source_url?: string;
  vendored_commit?: string;
  vendored_date?: string;
  published?: string | null;
  notes?: string;
}

interface Manifest {
  resources: ManifestResource[];
}

interface TreeEntry {
  path: string;
  type: "blob" | "tree";
  size?: number;
}

// Balances corpus-update propagation speed against GitHub's unauthenticated
// 60 req/hour rate limit (per source IP; Workers' egress IPs vary by colo,
// so this is comfortably inside budget even at low-to-moderate traffic).
const CACHE_TTL_SECONDS = 300;
// Immutable-URL TTL. A commit-SHA URL can never change, so content pinned to
// a resolved SHA is safe to cache far longer than a branch URL. This pays
// for the one commits-API resolve per request instead of adding to it.
const CACHE_TTL_PINNED_SECONDS = 86400;
// Text formats we'll read the actual bytes of and hand back as tool content.
// PDFs/spreadsheets are intentionally excluded -- see get_resource's notes
// field for why, and how an agent should fetch those instead.
const READABLE_EXTENSIONS = [".md", ".yaml", ".yml", ".json", ".txt"];

function ghHeaders(env: Env, accept: string): HeadersInit {
  const headers: Record<string, string> = {
    "User-Agent": "genai-security-advisor-mcp",
    Accept: accept,
  };
  if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  return headers;
}

async function cachedFetch(
  url: string,
  init: RequestInit,
  ctx: ExecutionContext,
  ttlSeconds = CACHE_TTL_SECONDS,
): Promise<Response> {
  const cache = caches.default;
  // Cache API keys on the request URL + method; GitHub URLs are stable per
  // resolved ref, so a plain GET cache key is enough.
  const cacheKey = new Request(url, { method: "GET" });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const resp = await fetch(url, init);
  if (resp.ok) {
    const toCache = new Response(resp.body, resp);
    toCache.headers.set("Cache-Control", `public, max-age=${ttlSeconds}`);
    ctx.waitUntil(cache.put(cacheKey, toCache.clone()));
    return toCache;
  }
  return resp;
}

export async function getManifest(
  env: Env,
  ctx: ExecutionContext,
  ref: string,
): Promise<Manifest> {
  const url = `https://raw.githubusercontent.com/${env.SOURCE_REPO}/${ref}/corpus/MANIFEST.yaml`;
  const resp = await cachedFetch(
    url,
    { headers: ghHeaders(env, "text/plain") },
    ctx,
    CACHE_TTL_PINNED_SECONDS,
  );
  if (!resp.ok) {
    throw new Error(`Failed to fetch MANIFEST.yaml: ${resp.status} ${resp.statusText}`);
  }
  const text = await resp.text();
  const data = yaml.load(text) as Manifest;
  if (!data || !Array.isArray(data.resources)) {
    throw new Error("MANIFEST.yaml did not parse to the expected { resources: [...] } shape");
  }
  // Validate the shape before trusting it: a malformed entry would otherwise
  // surface as undefined fields or silent filter misses downstream.
  for (const r of data.resources) {
    if (!r || typeof r.id !== "string" || typeof r.title !== "string") {
      throw new Error("MANIFEST.yaml contains a resource entry missing id/title");
    }
  }
  return data;
}

// Resolves SOURCE_REF to the exact commit SHA currently serving the corpus.
// This is the citation anchor: two consumers hitting the same revision see
// the same bytes, and an answer can name the commit it was read from.
//
// Failure policy: FAIL-CLOSED, deliberately. If the commits API is
// rate-limited or 5xx, this throws and the tool returns an error rather than
// serving content that cannot be pinned to a revision -- answering without a
// resolved SHA would silently break the citation contract. The resolve is
// cached (CACHE_TTL_SECONDS), so at most one commits-API call per 5 minutes
// per worker instance; fail-closed therefore costs availability only during
// a sustained API outage, and never serves an unpinned answer.
export async function getSourceRevision(env: Env, ctx: ExecutionContext): Promise<string> {
  const url = `https://api.github.com/repos/${env.SOURCE_REPO}/commits/${env.SOURCE_REF}`;
  const resp = await cachedFetch(url, { headers: ghHeaders(env, "application/vnd.github+json") }, ctx);
  if (!resp.ok) {
    throw new Error(`Failed to resolve ${env.SOURCE_REF}: ${resp.status} ${resp.statusText}`);
  }
  const data = (await resp.json()) as { sha: string };
  return data.sha;
}

// Full recursive file listing of the source repo, used both to list a
// resource's directory and to validate get_file requests (a path is only
// readable if it's actually in this tree -- prevents path traversal /
// fetching arbitrary paths outside corpus/).
export async function getTree(
  env: Env,
  ctx: ExecutionContext,
  ref: string,
): Promise<TreeEntry[]> {
  const url = `https://api.github.com/repos/${env.SOURCE_REPO}/git/trees/${ref}?recursive=1`;
  const resp = await cachedFetch(
    url,
    { headers: ghHeaders(env, "application/vnd.github+json") },
    ctx,
    CACHE_TTL_PINNED_SECONDS,
  );
  if (!resp.ok) {
    throw new Error(`Failed to fetch repo tree: ${resp.status} ${resp.statusText}`);
  }
  const data = (await resp.json()) as { tree: TreeEntry[]; truncated?: boolean };
  // GitHub's recursive trees API caps at 100k entries and silently sets
  // truncated: true. A truncated tree would make get_file report valid files
  // as "not found" and get_resource emit incomplete file lists -- fail closed
  // instead of serving a partial listing as if it were complete.
  if (data.truncated) {
    throw new Error("Repo tree exceeds GitHub's recursive API limit (truncated); refusing to serve a partial file listing");
  }
  return data.tree;
}

export function isReadablePath(path: string): boolean {
  return READABLE_EXTENSIONS.some((ext) => path.toLowerCase().endsWith(ext));
}

// Rejects anything that isn't a plain, forward-relative path under corpus/.
// No "..", no absolute paths, no protocol-relative tricks, no backslashes
// (Windows separators), no URL-encoded characters (%2e%2e is ".." once a
// server decodes it), and no control characters. Corpus paths are plain
// file paths -- anything needing encoding is a caller mistake.
export function isSafeCorpusPath(path: string): boolean {
  if (!path.startsWith("corpus/")) return false;
  if (path.includes("..")) return false;
  if (path.startsWith("/") || path.includes("://")) return false;
  if (path.includes("\\") || path.includes("%")) return false;
  if (/[\u0000-\u001f\u007f]/.test(path)) return false;
  return true;
}

export async function fetchRawFile(
  path: string,
  env: Env,
  ctx: ExecutionContext,
  ref: string,
): Promise<string> {
  const url = `https://raw.githubusercontent.com/${env.SOURCE_REPO}/${ref}/${encodePath(path)}`;
  const resp = await cachedFetch(
    url,
    { headers: ghHeaders(env, "text/plain") },
    ctx,
    CACHE_TTL_PINNED_SECONDS,
  );
  if (!resp.ok) {
    throw new Error(`Failed to fetch ${path}: ${resp.status} ${resp.statusText}`);
  }
  return resp.text();
}

// Files contained under a resource's manifest `path`. For a single-file
// resource this is just [path] itself; for a directory-shaped path
// (trailing "/") it's every blob in the tree under that prefix.
export function filesUnderPath(path: string, tree: TreeEntry[]): string[] {
  if (!path.endsWith("/")) return [path];
  const prefix = path;
  return tree
    .filter((e) => e.type === "blob" && e.path.startsWith(prefix))
    .map((e) => e.path)
    .sort();
}

// Corpus paths are repo-relative and may contain spaces or other characters
// that need percent-encoding in a URL. Encode per segment so slashes survive
// and nothing else does; matches how GitHub itself serves these files.
export function encodePath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export function rawUrl(path: string, env: Env, ref: string): string {
  return `https://raw.githubusercontent.com/${env.SOURCE_REPO}/${ref}/${encodePath(path)}`;
}

// Mirrors scripts/extract_pdf_text.py's naming convention in the source repo:
// corpus/foo/bar.pdf -> corpus/_extracted/foo/bar.pdf.txt
// These sidecars are an unreviewed, offline-generated search index (PDF
// parsing is far too CPU-heavy for a 10ms-per-request Workers free plan) --
// never present them as the citable source, only as search-index content.
export function extractedTextPath(pdfPath: string): string | null {
  if (!pdfPath.startsWith("corpus/") || !pdfPath.toLowerCase().endsWith(".pdf")) return null;
  const rest = pdfPath.slice("corpus/".length);
  return `corpus/_extracted/${rest}.txt`;
}
