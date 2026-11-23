import { describe, expect, test } from "bun:test";
import type {
  AssistantMessage,
  ItemRecord,
  JsonObject,
  JsonValue,
} from "@fresnel/contracts/conversation";
import {
  applyEdits,
  artifactKeyOfCall,
  artifactKindOfMediaType,
  artifactKindOfPath,
  artifactsOf,
  editsOfArgs,
  externalHostsOf,
  frameSourceOf,
  normalizeArtifactPath,
  outsideRefsOf,
  type ArtifactEntry,
} from "../../src/views/artifact/artifact-model.ts";
import { itm, prt } from "../state/helpers.ts";

// 산출물 모델 시험. 도구 호출은 assistant item의 toolCall 블록으로, 결과는 toolResult item으로 만든다.

const USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

type Block = AssistantMessage["content"][number];

function toolCall(id: string, name: string, args: JsonObject): Block {
  return { type: "toolCall", id, name, arguments: args };
}

function assistant(n: number, content: readonly Block[]): ItemRecord {
  return {
    itemId: itm(n),
    status: "completed",
    kind: "assistant",
    message: {
      role: "assistant",
      content: [...content],
      api: "anthropic-messages",
      provider: "anthropic",
      model: "m",
      usage: USAGE,
      stopReason: "toolUse",
      timestamp: 0,
    },
    partIds: content.map((_, i) => prt(n * 10 + i)),
  };
}

interface ResultOpts {
  readonly isError?: boolean;
  readonly details?: JsonValue;
  readonly text?: string;
}

function resultOf(n: number, callId: string, opts: ResultOpts = {}): ItemRecord {
  const text = opts.text ?? "";
  return {
    itemId: itm(n),
    status: "completed",
    kind: "toolResult",
    message: {
      role: "toolResult",
      toolCallId: callId,
      toolName: "tool",
      content: text === "" ? [] : [{ type: "text", text }],
      ...(opts.details === undefined ? {} : { details: opts.details }),
      isError: opts.isError ?? false,
      timestamp: 0,
    },
    effectId: null,
  };
}

function artifacts(
  records: readonly ItemRecord[],
  workspace: string | null = null,
): readonly ArtifactEntry[] {
  const items: Record<string, ItemRecord> = {};
  for (const r of records) items[r.itemId] = r;
  return artifactsOf({ itemIds: records.map((r) => r.itemId), items, workspace });
}

describe("산출물 종류", () => {
  test("경로의 확장자로 종류를 보고 대소문자를 가리지 않는다", () => {
    expect(artifactKindOfPath("site/index.html")).toEqual("html");
    expect(artifactKindOfPath("x.HTM")).toEqual("html");
    expect(artifactKindOfPath("logo.svg")).toEqual("svg");
    expect(artifactKindOfPath("p.PNG")).toEqual("image");
    expect(artifactKindOfPath("p.jpeg")).toEqual("image");
    expect(artifactKindOfPath("p.jpg")).toEqual("image");
    expect(artifactKindOfPath("p.gif")).toEqual("image");
    expect(artifactKindOfPath("p.webp")).toEqual("image");
    expect(artifactKindOfPath("notes.MD")).toEqual("markdown");
    expect(artifactKindOfPath("notes.markdown")).toEqual("markdown");
  });

  test("목록에 없는 확장자, 확장자 없는 이름, 숨김 파일 이름은 null", () => {
    expect(artifactKindOfPath("main.ts")).toEqual(null);
    expect(artifactKindOfPath("README")).toEqual(null);
    expect(artifactKindOfPath(".html")).toEqual(null);
    expect(artifactKindOfPath("dir.html/x")).toEqual(null);
  });

  test("미디어 타입은 매개변수와 대소문자를 무시하고 종류로 바꾼다", () => {
    expect(artifactKindOfMediaType("text/html; charset=utf-8")).toEqual("html");
    expect(artifactKindOfMediaType("IMAGE/SVG+XML")).toEqual("svg");
    expect(artifactKindOfMediaType("text/markdown")).toEqual("markdown");
    expect(artifactKindOfMediaType("image/png")).toEqual("image");
    expect(artifactKindOfMediaType("text/csv")).toEqual(null);
  });
});

describe("경로 정규화와 화면 틀의 원천", () => {
  test("앞의 ./, 연속 /, 끝의 /를 정리하고 작업 폴더 안의 절대 경로는 상대 경로가 된다", () => {
    expect(normalizeArtifactPath("./a//b/", null)).toEqual("a/b");
    expect(normalizeArtifactPath("/Users/u/p/docs/a.html", "/Users/u/p")).toEqual("docs/a.html");
    expect(normalizeArtifactPath("/Users/u/p/a.html", "/Users/u/p/")).toEqual("a.html");
    expect(normalizeArtifactPath("/Users/u/p2/a.html", "/Users/u/p")).toEqual("/Users/u/p2/a.html");
    expect(normalizeArtifactPath("/abs/a.html", null)).toEqual("/abs/a.html");
  });

  test("작업 폴더 안의 상대 경로만 root를 준다. .., ., 밖의 절대 경로, 폴더 없음은 이름만 준다", () => {
    expect(frameSourceOf("docs/a.html", "/w")).toEqual({ root: "/w", entry: "docs/a.html" });
    expect(frameSourceOf("/w/docs/a.html", "/w")).toEqual({ root: "/w", entry: "docs/a.html" });
    expect(frameSourceOf("../x/a.html", "/w")).toEqual({ root: null, entry: "a.html" });
    expect(frameSourceOf("a/./b.html", "/w")).toEqual({ root: null, entry: "b.html" });
    expect(frameSourceOf("/etc/a.html", "/w")).toEqual({ root: null, entry: "a.html" });
    expect(frameSourceOf("docs/a.html", null)).toEqual({ root: null, entry: "a.html" });
  });
});

describe("편집 적용", () => {
  test("oldText가 한 곳에만 있어야 하고, 위치 순서와 상관없이 원본에 대고 적용한다", () => {
    expect(
      applyEdits("abcdef", [
        { oldText: "e", newText: "E" },
        { oldText: "b", newText: "B" },
      ]),
    ).toEqual("aBcdEf");
  });

  test("빈 oldText, 없는 oldText, 두 곳 이상 있는 oldText, 겹치는 편집, 바뀌지 않는 편집, 빈 목록은 null", () => {
    expect(applyEdits("abc", [{ oldText: "", newText: "x" }])).toEqual(null);
    expect(applyEdits("abc", [{ oldText: "zz", newText: "x" }])).toEqual(null);
    expect(applyEdits("ab ab", [{ oldText: "ab", newText: "x" }])).toEqual(null);
    expect(
      applyEdits("abcdef", [
        { oldText: "bcd", newText: "X" },
        { oldText: "cde", newText: "Y" },
      ]),
    ).toEqual(null);
    expect(applyEdits("abc", [{ oldText: "b", newText: "b" }])).toEqual(null);
    expect(applyEdits("abc", [])).toEqual(null);
  });

  test("편집 인자의 세 모양(JSON 글, 단일 객체, 최상위 쌍)을 편집 목록으로 읽고, 모르는 모양은 null이다", () => {
    const pair = [{ oldText: "a", newText: "b" }];
    expect(editsOfArgs({ edits: '[{"oldText":"a","newText":"b"}]' })).toEqual(pair);
    expect(editsOfArgs({ edits: { oldText: "a", newText: "b" } })).toEqual(pair);
    expect(editsOfArgs({ oldText: "a", newText: "b" })).toEqual(pair);
    expect(editsOfArgs({ edits: "not json", oldText: "a", newText: "b" })).toEqual(pair);
    expect(editsOfArgs({ path: "a.html" })).toEqual(null);
    expect(editsOfArgs("x")).toEqual(null);
  });
});

describe("artifactsOf: 파일 쓰기와 편집", () => {
  test("write→edit→edit 체인이 버전마다 정확한 본문을 다시 만든다", () => {
    const entries = artifacts([
      assistant(1, [
        toolCall("c1", "write", { path: "site/index.html", content: "<h1>one</h1>\n<p>x</p>" }),
      ]),
      resultOf(2, "c1", { text: "Wrote" }),
      assistant(3, [
        toolCall("c2", "edit", {
          path: "site/index.html",
          edits: [{ oldText: "one", newText: "uno" }],
        }),
      ]),
      resultOf(4, "c2", { text: "Edited" }),
      assistant(5, [
        toolCall("c3", "edit", {
          path: "./site//index.html",
          edits: [
            { oldText: "<p>x</p>", newText: "<p>y</p>" },
            { oldText: "uno", newText: "dos" },
          ],
        }),
      ]),
      resultOf(6, "c3"),
    ]);
    expect(entries).toEqual([
      {
        key: "file:site/index.html",
        source: { kind: "file", path: "site/index.html" },
        kind: "html",
        title: "index.html",
        pending: false,
        versions: [
          { number: 1, callId: "c1", itemId: itm(1), op: "write", text: "<h1>one</h1>\n<p>x</p>" },
          { number: 2, callId: "c2", itemId: itm(3), op: "edit", text: "<h1>uno</h1>\n<p>x</p>" },
          { number: 3, callId: "c3", itemId: itm(5), op: "edit", text: "<h1>dos</h1>\n<p>y</p>" },
        ],
      },
    ]);
  });

  test("편집이 어긋나면 그 버전은 null이고, 다음 편집도 null이며, 새 쓰기에서 다시 이어진다", () => {
    const entries = artifacts([
      assistant(1, [toolCall("c1", "write", { path: "a.md", content: "x y x" })]),
      resultOf(2, "c1"),
      assistant(3, [
        toolCall("c2", "edit", { path: "a.md", edits: [{ oldText: "x", newText: "z" }] }),
      ]),
      resultOf(4, "c2"),
      assistant(5, [
        toolCall("c3", "edit", { path: "a.md", edits: [{ oldText: "y", newText: "Y" }] }),
      ]),
      resultOf(6, "c3"),
      assistant(7, [toolCall("c4", "write", { path: "a.md", content: "fresh" })]),
      resultOf(8, "c4"),
      assistant(9, [
        toolCall("c5", "edit", { path: "a.md", edits: [{ oldText: "fresh", newText: "FRESH" }] }),
      ]),
      resultOf(10, "c5"),
    ]);
    expect(entries.map((e) => e.versions.map((v) => v.text))).toEqual([
      ["x y x", null, null, "fresh", "FRESH"],
    ]);
  });

  test("없는 oldText로 편집하면 그 버전은 null이다", () => {
    const entries = artifacts([
      assistant(1, [toolCall("c1", "write", { path: "a.txt.html", content: "abc" })]),
      resultOf(2, "c1"),
      assistant(3, [
        toolCall("c2", "edit", { path: "a.txt.html", edits: [{ oldText: "zzz", newText: "q" }] }),
      ]),
      resultOf(4, "c2"),
    ]);
    expect(entries[0]?.versions.map((v) => v.text)).toEqual(["abc", null]);
  });

  test("문자열 JSON edits, 단일 객체 edits, 최상위 oldText/newText를 모두 적용한다", () => {
    const entries = artifacts([
      assistant(1, [toolCall("c1", "write", { path: "a.html", content: "hello world" })]),
      resultOf(2, "c1"),
      assistant(3, [
        toolCall("c2", "edit", { path: "a.html", edits: '[{"oldText":"hello","newText":"hi"}]' }),
      ]),
      resultOf(4, "c2"),
      assistant(5, [
        toolCall("c3", "edit", { path: "a.html", edits: { oldText: "world", newText: "there" } }),
      ]),
      resultOf(6, "c3"),
      assistant(7, [toolCall("c4", "edit", { path: "a.html", oldText: "hi", newText: "yo" })]),
      resultOf(8, "c4"),
      assistant(9, [
        toolCall("c5", "edit", {
          path: "a.html",
          edits: "not json",
          oldText: "yo",
          newText: "hey",
        }),
      ]),
      resultOf(10, "c5"),
    ]);
    expect(entries[0]?.versions.map((v) => v.text)).toEqual([
      "hello world",
      "hi world",
      "hi there",
      "yo there",
      "hey there",
    ]);
  });

  test("오류 결과는 버전이 아니고, 오류뿐인 파일은 산출물이 되지 않는다", () => {
    const entries = artifacts([
      assistant(1, [toolCall("c1", "write", { path: "a.html", content: "gone" })]),
      resultOf(2, "c1", { isError: true, text: "denied" }),
      assistant(3, [toolCall("c2", "write", { path: "b.html", content: "two" })]),
      resultOf(4, "c2", { text: "Wrote" }),
      assistant(5, [
        toolCall("c3", "edit", { path: "b.html", edits: [{ oldText: "two", newText: "2" }] }),
      ]),
      resultOf(6, "c3", { isError: true, text: "failed" }),
    ]);
    expect(entries).toEqual([
      {
        key: "file:b.html",
        source: { kind: "file", path: "b.html" },
        kind: "html",
        title: "b.html",
        pending: false,
        versions: [{ number: 1, callId: "c2", itemId: itm(3), op: "write", text: "two" }],
      },
    ]);
  });

  test("결과가 없는 호출은 대기로 표시하고, 없던 산출물이면 버전 없이 만든다", () => {
    const entries = artifacts([
      assistant(1, [toolCall("c1", "write", { path: "p.html", content: "x" })]),
      assistant(2, [toolCall("c2", "write", { path: "q.html", content: "q" })]),
      resultOf(3, "c2"),
      assistant(4, [
        toolCall("c3", "edit", { path: "q.html", edits: [{ oldText: "q", newText: "Q" }] }),
      ]),
    ]);
    expect(entries).toEqual([
      {
        key: "file:p.html",
        source: { kind: "file", path: "p.html" },
        kind: "html",
        title: "p.html",
        pending: true,
        versions: [],
      },
      {
        key: "file:q.html",
        source: { kind: "file", path: "q.html" },
        kind: "html",
        title: "q.html",
        pending: true,
        versions: [{ number: 1, callId: "c2", itemId: itm(2), op: "write", text: "q" }],
      },
    ]);
  });

  test("절대 경로와 앞의 ./가 달라도 작업 폴더 기준으로 같은 파일 한 산출물이 되고, 종류가 없는 경로는 뺀다", () => {
    const entries = artifacts(
      [
        assistant(1, [toolCall("c1", "write", { path: "/w/docs/a.html", content: "one" })]),
        resultOf(2, "c1"),
        assistant(3, [toolCall("c2", "write", { path: "./docs//a.html", content: "two" })]),
        resultOf(4, "c2"),
        assistant(5, [toolCall("c3", "write", { path: "main.ts", content: "code" })]),
        resultOf(6, "c3"),
      ],
      "/w",
    );
    expect(entries.map((e) => e.key)).toEqual(["file:docs/a.html"]);
    expect(entries[0]?.versions.map((v) => v.text)).toEqual(["one", "two"]);
  });
});

describe("artifactsOf: 등록 산출물", () => {
  test("artifact_create는 결과 details의 artifactId로 id를 얻는다", () => {
    const entries = artifacts([
      assistant(1, [
        toolCall("c1", "artifact_create", {
          kind: "document",
          title: "Report",
          text: "<h1>r</h1>",
          mediaType: "text/html",
        }),
      ]),
      resultOf(2, "c1", {
        details: { artifactId: "art_1", version: 1, title: "Report", mediaType: "text/html" },
        text: 'artifact art_1 v1 kind=document title="Report"',
      }),
    ]);
    expect(entries).toEqual([
      {
        key: "art:art_1",
        source: { kind: "registered", artifactId: "art_1" },
        kind: "html",
        title: "Report",
        pending: false,
        versions: [{ number: 1, callId: "c1", itemId: itm(1), op: "create", text: "<h1>r</h1>" }],
      },
    ]);
  });

  test("details가 없으면 결과 글의 artifact <id> v<n>에서 id를 읽고, 미디어 타입을 안 주면 markdown이다", () => {
    const entries = artifacts([
      assistant(1, [
        toolCall("c1", "artifact_create", { kind: "document", title: "Notes", text: "# n" }),
      ]),
      resultOf(2, "c1", { text: 'artifact art_2 v1 kind=document title="Notes"' }),
    ]);
    expect(entries).toEqual([
      {
        key: "art:art_2",
        source: { kind: "registered", artifactId: "art_2" },
        kind: "markdown",
        title: "Notes",
        pending: false,
        versions: [{ number: 1, callId: "c1", itemId: itm(1), op: "create", text: "# n" }],
      },
    ]);
  });

  test("artifact_update는 본문을 주면 그 본문을, 안 주면 앞 본문을 쓴다. 보이는 미디어 타입만 종류를 바꾼다", () => {
    const created = resultOf(2, "c1", { details: { artifactId: "art_3" } });
    const entries = artifacts([
      assistant(1, [
        toolCall("c1", "artifact_create", {
          kind: "document",
          title: "Draft",
          text: "<p>1</p>",
          mediaType: "text/html",
        }),
      ]),
      created,
      assistant(3, [
        toolCall("c2", "artifact_update", {
          artifactId: "art_3",
          baseVersion: 1,
          text: "<p>2</p>",
        }),
      ]),
      resultOf(4, "c2"),
      assistant(5, [
        toolCall("c3", "artifact_update", {
          artifactId: "art_3",
          baseVersion: 2,
          title: "Renamed",
        }),
      ]),
      resultOf(6, "c3"),
      assistant(7, [
        toolCall("c4", "artifact_update", {
          artifactId: "art_3",
          baseVersion: 3,
          mediaType: "text/markdown",
          text: "# m",
        }),
      ]),
      resultOf(8, "c4"),
      assistant(9, [
        toolCall("c5", "artifact_update", {
          artifactId: "art_3",
          baseVersion: 4,
          mediaType: "text/csv",
          text: "a,b",
        }),
      ]),
      resultOf(10, "c5"),
      assistant(11, [
        toolCall("c6", "artifact_update", { artifactId: "art_3", baseVersion: 5, text: "bad" }),
      ]),
      resultOf(12, "c6", { isError: true, text: "version_conflict" }),
      assistant(13, [
        toolCall("c7", "artifact_update", { artifactId: "art_9", baseVersion: 1, text: "x" }),
      ]),
      resultOf(14, "c7"),
    ]);
    expect(entries).toEqual([
      {
        key: "art:art_3",
        source: { kind: "registered", artifactId: "art_3" },
        kind: "markdown",
        title: "Renamed",
        pending: false,
        versions: [
          { number: 1, callId: "c1", itemId: itm(1), op: "create", text: "<p>1</p>" },
          { number: 2, callId: "c2", itemId: itm(3), op: "update", text: "<p>2</p>" },
          { number: 3, callId: "c3", itemId: itm(5), op: "update", text: "<p>2</p>" },
          { number: 4, callId: "c4", itemId: itm(7), op: "update", text: "# m" },
          { number: 5, callId: "c5", itemId: itm(9), op: "update", text: "a,b" },
        ],
      },
    ]);
  });

  test("결과가 없는 갱신은 이미 있는 산출물을 대기로 표시하고, 없는 산출물은 만들지 않는다", () => {
    const entries = artifacts([
      assistant(1, [
        toolCall("c1", "artifact_create", {
          kind: "document",
          title: "T",
          text: "t",
          mediaType: "text/html",
        }),
      ]),
      resultOf(2, "c1", { details: { artifactId: "art_4" } }),
      assistant(3, [
        toolCall("c2", "artifact_update", { artifactId: "art_4", baseVersion: 1, text: "u" }),
      ]),
      assistant(4, [
        toolCall("c3", "artifact_update", { artifactId: "art_5", baseVersion: 1, text: "u" }),
      ]),
    ]);
    expect(entries.map((e) => [e.key, e.pending, e.versions.length])).toEqual([
      ["art:art_4", true, 1],
    ]);
  });

  test("표로 만든 산출물은 볼 수 없는 종류라 뺀다", () => {
    const entries = artifacts([
      assistant(1, [toolCall("c1", "artifact_create", { kind: "table", title: "T", text: "a,b" })]),
      resultOf(2, "c1", { details: { artifactId: "art_6" } }),
    ]);
    expect(entries).toEqual([]);
  });
});

describe("artifactKeyOfCall", () => {
  test("write·edit는 정규화한 파일 키를, 종류가 없는 경로는 null을 준다", () => {
    const write = { name: "write", resultDetails: null, resultText: null, workspace: "/w" };
    expect(artifactKeyOfCall({ ...write, args: { path: "./x//a.html", content: "" } })).toEqual(
      "file:x/a.html",
    );
    expect(artifactKeyOfCall({ ...write, args: { path: "/w/x/a.html", content: "" } })).toEqual(
      "file:x/a.html",
    );
    expect(artifactKeyOfCall({ ...write, args: { path: "a.ts", content: "" } })).toEqual(null);
  });

  test("artifact_create는 결과의 id로, 결과가 없으면 null이고, 표는 null이다", () => {
    const create = {
      name: "artifact_create",
      args: { kind: "document", title: "T", text: "t" },
      workspace: null,
    };
    expect(
      artifactKeyOfCall({ ...create, resultDetails: { artifactId: "art_5" }, resultText: null }),
    ).toEqual("art:art_5");
    expect(
      artifactKeyOfCall({
        ...create,
        resultDetails: null,
        resultText: 'artifact art_7 v1 kind=document title="T"',
      }),
    ).toEqual("art:art_7");
    expect(artifactKeyOfCall({ ...create, resultDetails: null, resultText: null })).toEqual(null);
    expect(
      artifactKeyOfCall({
        name: "artifact_create",
        args: { kind: "table", title: "T", text: "a,b" },
        resultDetails: { artifactId: "art_6" },
        resultText: null,
        workspace: null,
      }),
    ).toEqual(null);
  });

  test("artifact_update는 인자의 artifactId로, 그 밖의 도구는 null이다", () => {
    expect(
      artifactKeyOfCall({
        name: "artifact_update",
        args: { artifactId: "art_5", baseVersion: 1 },
        resultDetails: null,
        resultText: null,
        workspace: null,
      }),
    ).toEqual("art:art_5");
    expect(
      artifactKeyOfCall({
        name: "bash",
        args: { command: "ls" },
        resultDetails: null,
        resultText: null,
        workspace: null,
      }),
    ).toEqual(null);
  });
});

describe("외부 주소와 폴더 밖 참조", () => {
  test("절대 http(s) 주소의 호스트를 처음 나온 순서로 모으고, w3.org와 중복은 뺀다", () => {
    const text =
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://img.example.com/a.png"/>' +
      '<script src="HTTPS://CDN.example.com/x.js"></script><style>@import url(https://fonts.example.org/f.css);' +
      ".a{background:url(https://img.example.com/b.png)}</style>" +
      '<a href="http://example.com/x">x</a></svg>';
    expect(externalHostsOf(text)).toEqual([
      "img.example.com",
      "cdn.example.com",
      "fonts.example.org",
      "example.com",
    ]);
    expect(externalHostsOf('<svg xmlns="http://www.w3.org/2000/svg"></svg>')).toEqual([]);
  });

  test("호스트는 여덟 개까지만 준다", () => {
    const text = Array.from({ length: 10 }, (_, i) => `https://h${i}.test/`).join(" ");
    expect(externalHostsOf(text)).toEqual(Array.from({ length: 8 }, (_, i) => `h${i}.test`));
  });

  test("src, href, url(), @import의 폴더 밖 참조만 처음 나온 순서로 모은다", () => {
    const text =
      '<img src="../secret.png"><img src=\'./ok.png\'><link href="/abs/site.css">' +
      '<link href="//cdn.example.com/x.css"><div style="background:url(../fonts/a.woff)"></div>' +
      '<style>@import "../base.css";</style><a href="file:///etc/hosts">f</a><img src="../secret.png">';
    expect(outsideRefsOf(text)).toEqual([
      "../secret.png",
      "/abs/site.css",
      "../fonts/a.woff",
      "../base.css",
      "file:///etc/hosts",
    ]);
  });

  test("폴더 밖 참조도 여덟 개까지만 준다", () => {
    const text = Array.from({ length: 10 }, (_, i) => `<img src="../n${i}.png">`).join("");
    expect(outsideRefsOf(text)).toEqual(Array.from({ length: 8 }, (_, i) => `../n${i}.png`));
  });
});
