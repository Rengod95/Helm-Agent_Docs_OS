import { describe, expect, test } from "bun:test";
import { parse } from "../../src/base/index.ts";
import {
  ARTIFACT_FILES_KEY,
  ArtifactFileEntrySchema,
  MAX_ARTIFACT_FILES,
  type ArtifactFileEntry,
  WorkspaceShell,
  artifactFilesOf,
  viewableKindOfPath,
  type ToolContent,
} from "../../src/capabilities/index.ts";

// 셸 산출물 목록(S-08)의 모양과 `details` 자리. 결과 글은 그대로이고 목록은 `details`에만 나간다.

const svg = {
  path: "/work/out/chart.svg",
  op: "create",
  size: 120,
  mtimeMs: 1700,
} satisfies ArtifactFileEntry;
const html = {
  path: "/work/index.HTML",
  op: "modify",
  size: 5,
  mtimeMs: 1800.5,
} satisfies ArtifactFileEntry;

describe("viewable kinds", () => {
  test("the extensions map to the four kinds, case-insensitively", () => {
    expect(viewableKindOfPath("/w/a.svg")).toBe("svg");
    expect(viewableKindOfPath("/w/a.HTML")).toBe("html");
    expect(viewableKindOfPath("/w/a.htm")).toBe("html");
    expect(viewableKindOfPath("/w/a.JPEG")).toBe("image");
    expect(viewableKindOfPath("/w/a.webp")).toBe("image");
    expect(viewableKindOfPath("/w/notes.markdown")).toBe("markdown");
  });

  test("no extension, a leading dot, or an unlisted extension is not viewable", () => {
    expect(viewableKindOfPath("/w/README")).toBeNull();
    expect(viewableKindOfPath("/w/.svg")).toBeNull();
    expect(viewableKindOfPath("/w/data.json")).toBeNull();
    expect(viewableKindOfPath("/w/dir.svg/readme")).toBeNull();
  });
});

describe("artifact file entries", () => {
  test("an entry is a closed object with the four fields", () => {
    expect(parse(ArtifactFileEntrySchema, svg).ok).toBe(true);
    expect(parse(ArtifactFileEntrySchema, { ...svg, extra: 1 }).ok).toBe(false);
    expect(parse(ArtifactFileEntrySchema, { ...svg, op: "delete" }).ok).toBe(false);
    expect(parse(ArtifactFileEntrySchema, { ...svg, size: -1 }).ok).toBe(false);
  });

  test("the reserved key is artifactFiles and the cap is 32", () => {
    expect(ARTIFACT_FILES_KEY).toBe("artifactFiles");
    expect(MAX_ARTIFACT_FILES).toBe(32);
  });

  test("the reader takes the list and ignores the tool's own keys", () => {
    const details = { truncation: { by: "bytes" }, [ARTIFACT_FILES_KEY]: [svg, html] };
    expect(JSON.stringify(artifactFilesOf(details))).toBe(JSON.stringify([svg, html]));
  });

  test("null, a missing key, or a malformed list reads as empty", () => {
    expect(artifactFilesOf(null)).toEqual([]);
    expect(artifactFilesOf({ output: "x" })).toEqual([]);
    expect(artifactFilesOf({ [ARTIFACT_FILES_KEY]: [{ ...svg, op: "rename" }] })).toEqual([]);
  });
});

describe("bash result", () => {
  const bash = WorkspaceShell.tools.find((tool) => tool.name === "bash");
  const plain = {
    exitCode: 0,
    output: "wrote chart.svg\n",
    truncated: false,
    durationMs: 4,
    sandboxed: true,
  };

  test("the list goes to details; the result text and the structured value do not carry it", () => {
    const rendered: ToolContent | undefined = bash?.toContent?.({ ...plain, artifactFiles: [svg] });
    expect(rendered?.content).toEqual([{ type: "text", text: "wrote chart.svg\n" }]);
    expect(rendered?.details).toEqual({ [ARTIFACT_FILES_KEY]: [svg] });
    expect(rendered?.structuredContent).toEqual(plain);
  });

  test("a result without a list has no details", () => {
    const rendered: ToolContent | undefined = bash?.toContent?.(plain);
    expect(rendered?.details).toBeUndefined();
    expect(rendered?.structuredContent).toEqual(plain);
  });
});
