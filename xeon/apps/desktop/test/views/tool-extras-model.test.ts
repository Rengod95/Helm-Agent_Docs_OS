import { describe, expect, test } from "bun:test";
import {
  REPORT_FOLD_LINES,
  agentHeadOf,
  agentResultOf,
  citedLinksOf,
  reportFoldOf,
  webSourcesOf,
} from "../../src/views/tool-extras-model.ts";

describe("agentHeadOf", () => {
  test("joins the definition name and the first line of the task", () => {
    expect(agentHeadOf({ agent: "explore", task: "폴더를 조사해\n둘째 줄" })).toBe(
      "explore · 폴더를 조사해",
    );
  });
  test("a long task is clipped and a missing task leaves the name alone", () => {
    expect(agentHeadOf({ agent: "general", task: "가".repeat(100) })).toBe(
      `general · ${"가".repeat(80)}…`,
    );
    expect(agentHeadOf({ agent: "general" })).toBe("general");
    expect(agentHeadOf(null)).toBe("");
  });
});

describe("agentResultOf", () => {
  test("a finished run keeps the report and the child thread id", () => {
    expect(agentResultOf("요약", { childThreadId: "thr_1", status: "completed" }, false)).toEqual({
      childThreadId: "thr_1",
      outcome: "completed",
      body: "요약",
    });
  });
  test("the engine's report wrapper tag is not part of the shown report", () => {
    const wrapped =
      '<subagent_report agent="explore" status="completed">\n요약 글\n</subagent_report>';
    expect(agentResultOf(wrapped, { status: "completed" }, false).body).toBe("요약 글");
  });
  test("an aborted run is aborted, not an error", () => {
    expect(agentResultOf("", { childThreadId: "thr_1", status: "aborted" }, true).outcome).toBe(
      "aborted",
    );
    expect(agentResultOf("[fresnel:aborted] stop", undefined, true)).toEqual({
      childThreadId: null,
      outcome: "aborted",
      body: "stop",
    });
  });
  test("an error keeps its reason without the code tag", () => {
    expect(
      agentResultOf("[fresnel:subagent_error] agents.x: boom", { status: "error" }, true),
    ).toEqual({ childThreadId: null, outcome: "error", body: "agents.x: boom" });
  });
});

describe("reportFoldOf", () => {
  test("a short report is not folded and a long one keeps the head lines", () => {
    expect(reportFoldOf("a\nb")).toEqual({ head: "a\nb", rest: null });
    const long = Array.from({ length: REPORT_FOLD_LINES + 3 }, (_, i) => String(i)).join("\n");
    const fold = reportFoldOf(long);
    expect(fold.head.split("\n")).toHaveLength(REPORT_FOLD_LINES);
    expect(fold.rest?.split("\n")).toEqual(["12", "13", "14"]);
  });
});

describe("webSourcesOf", () => {
  test("reads source lines, drops the date, www and duplicates, and skips non-http", () => {
    const text = [
      '<untrusted_web_content sources="s1 s2">',
      "[s1] Bun (2025-04-30) https://www.bun.sh/docs",
      "[s2] https://example.com/a",
      "[s3] Dup https://www.bun.sh/docs",
      "[s4] Bad javascript:alert(1)",
      "</untrusted_web_content>",
    ].join("\n");
    expect(webSourcesOf(text)).toEqual([
      { id: "s1", title: "Bun", url: "https://www.bun.sh/docs", domain: "bun.sh" },
      { id: "s2", title: "example.com", url: "https://example.com/a", domain: "example.com" },
    ]);
  });
});

describe("citedLinksOf", () => {
  test("finds bare and markdown links without trailing punctuation, up to the limit", () => {
    const links = citedLinksOf(
      "보세요 https://a.dev/x. 또 [b](https://b.dev/y) 와 https://c.dev",
      2,
    );
    expect(links.map((l) => l.url)).toEqual(["https://a.dev/x", "https://b.dev/y"]);
  });
});
