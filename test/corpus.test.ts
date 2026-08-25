import { describe, expect, it } from "vitest";
import {
  encodePath,
  extractedTextPath,
  filesUnderPath,
  isSafeCorpusPath,
  isReadablePath,
} from "../src/corpus.js";

describe("isSafeCorpusPath", () => {
  it("accepts a plain corpus path", () => {
    expect(isSafeCorpusPath("corpus/llm-top10/2026/LLM01.md")).toBe(true);
  });

  it("rejects paths outside corpus/", () => {
    expect(isSafeCorpusPath("README.md")).toBe(false);
    expect(isSafeCorpusPath("lib/foo.md")).toBe(false);
  });

  it("rejects traversal and encoded traversal", () => {
    expect(isSafeCorpusPath("corpus/../etc/passwd")).toBe(false);
    expect(isSafeCorpusPath("corpus/a/../../b.md")).toBe(false);
    // %2e%2e is ".." once a server decodes it.
    expect(isSafeCorpusPath("corpus/%2e%2e/secret.md")).toBe(false);
    // Backslash separators are a Windows traversal vector.
    expect(isSafeCorpusPath("corpus\\..\\secret.md")).toBe(false);
  });

  it("rejects absolute and protocol-relative paths", () => {
    expect(isSafeCorpusPath("/corpus/foo.md")).toBe(false);
    expect(isSafeCorpusPath("https://evil.example/corpus/foo.md")).toBe(false);
    expect(isSafeCorpusPath("//evil.example/corpus/foo.md")).toBe(false);
  });

  it("rejects control characters and percent-encoded content", () => {
    expect(isSafeCorpusPath("corpus/foo\u0000.md")).toBe(false);
    expect(isSafeCorpusPath("corpus/foo%20bar.md")).toBe(false);
  });
});

describe("isReadablePath", () => {
  it("accepts text formats the server reads", () => {
    expect(isReadablePath("corpus/foo.md")).toBe(true);
    expect(isReadablePath("corpus/foo.yaml")).toBe(true);
    expect(isReadablePath("corpus/foo.yml")).toBe(true);
    expect(isReadablePath("corpus/foo.json")).toBe(true);
    expect(isReadablePath("corpus/foo.txt")).toBe(true);
  });

  it("rejects binaries and PDFs", () => {
    expect(isReadablePath("corpus/foo.pdf")).toBe(false);
    expect(isReadablePath("corpus/foo.xlsx")).toBe(false);
    expect(isReadablePath("corpus/foo.docx")).toBe(false);
  });
});

describe("extractedTextPath", () => {
  it("maps a PDF under corpus/ to its sidecar", () => {
    expect(extractedTextPath("corpus/foo/bar.pdf")).toBe("corpus/_extracted/foo/bar.pdf.txt");
  });

  it("returns null for non-PDFs and out-of-tree paths", () => {
    expect(extractedTextPath("corpus/foo/bar.md")).toBe(null);
    expect(extractedTextPath("docs/foo.pdf")).toBe(null);
  });
});

describe("filesUnderPath", () => {
  const tree = [
    { path: "corpus/llm-top10/2026/LLM01.md", type: "blob" as const },
    { path: "corpus/llm-top10/2026/LLM02.md", type: "blob" as const },
    { path: "corpus/llm-top10/2026/README.md", type: "blob" as const },
    { path: "corpus/other/x.md", type: "blob" as const },
    { path: "corpus/llm-top10/2026/sub", type: "tree" as const },
  ];

  it("returns a single file for a file path", () => {
    expect(filesUnderPath("corpus/llm-top10/2026/LLM01.md", tree)).toEqual([
      "corpus/llm-top10/2026/LLM01.md",
    ]);
  });

  it("lists blobs under a directory prefix, excluding nested dirs", () => {
    expect(filesUnderPath("corpus/llm-top10/2026/", tree)).toEqual([
      "corpus/llm-top10/2026/LLM01.md",
      "corpus/llm-top10/2026/LLM02.md",
      "corpus/llm-top10/2026/README.md",
    ]);
  });
});

describe("encodePath", () => {
  it("preserves slashes and encodes special characters", () => {
    expect(encodePath("corpus/foo bar/baz#1.md")).toBe(
      "corpus/foo%20bar/baz%231.md",
    );
  });

  it("leaves already-safe paths untouched", () => {
    expect(encodePath("corpus/llm-top10/2026/LLM01.md")).toBe(
      "corpus/llm-top10/2026/LLM01.md",
    );
  });
});
