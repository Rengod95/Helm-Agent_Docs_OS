import { describe, expect, test } from "bun:test";
import { Bug } from "@fresnel/contracts";
import type { ReviewItem } from "@fresnel/contracts/wire";
import { changeWhatOf, workFactsOf } from "../../../src/views/craft/review/review-facts.ts";
import { sampleItems } from "../../../src/views/craft/review/testing/review-samples.ts";

// 리뷰 상세 "작동 방식"의 네 줄(시점 / 입력 / 영향 / 출력). 내부 Hook 이름은 싣지 않고 자리·종류·힘으로 바꾼 값을 본다.

function sample(itemId: string): ReviewItem {
  const found = sampleItems().find((item) => item.itemId === itemId);
  if (found === undefined) throw new Bug(`no sample ${itemId}`);
  return found;
}

describe("how it works: when / reads / effect / gives", () => {
  test("a guard hook before tool calls reads tool calls, blocks or replaces, and gives a decision", () => {
    const facts = workFactsOf(sample("rvw_sample_lint").card);
    expect(facts.when).toEqual([{ kind: "place", place: { group: "tool", side: "before" } }]);
    expect(facts.reads).toEqual([{ kind: "hook", hook: "tool" }]);
    expect(facts.changes).toEqual([{ kind: "power", power: "decide" }]);
    expect(facts.gives).toEqual([{ kind: "decision" }]);
  });

  test("tools from an MCP server: called by the model, read arguments and the env names, give the tool names", () => {
    const facts = workFactsOf(sample("rvw_sample_fetch").card);
    expect(facts.when).toEqual([{ kind: "toolCall" }]);
    expect(facts.reads).toEqual([{ kind: "toolArgs" }, { kind: "env", value: "FETCH_API_KEY" }]);
    expect(facts.changes).toEqual([]);
    expect(facts.gives).toEqual([
      { kind: "tool", value: "fetch_page" },
      { kind: "tool", value: "fetch_many" },
    ]);
  });

  test("a Drive with a command starts on that command, reads the chat and leads it", () => {
    const facts = workFactsOf(sample("rvw_sample_drive").card);
    expect(facts.when).toEqual([{ kind: "command", value: "/review" }]);
    expect(facts.reads).toEqual([{ kind: "thread" }]);
    expect(facts.changes).toEqual([{ kind: "leads" }]);
    expect(facts.gives).toEqual([]);
  });

  test("an always-on instruction rides every request and adds to the instructions; a skill is on demand", () => {
    expect(workFactsOf(sample("rvw_sample_rule").card)).toEqual({
      when: [{ kind: "everyRequest" }],
      reads: [],
      changes: [{ kind: "instructions" }],
      gives: [],
      screens: [],
    });
    const notes = workFactsOf(sample("rvw_sample_notes").card);
    expect(notes.when).toEqual([{ kind: "onDemand" }]);
    expect(notes.gives).toEqual([{ kind: "skill", value: "release-notes" }]);
  });
});

describe("screens: 화면 줄은 카드의 화면 칸을 매니페스트 선언 그대로 보인다", () => {
  test("a native screen has its place and id; an own-code screen adds its reason and bridge capabilities", () => {
    const card = sample("rvw_sample_fetch").card;
    const inject = card.does.inject;
    if (inject === null) throw new Bug("the sample has no inject inventory");
    const facts = workFactsOf({
      ...card,
      does: {
        ...card.does,
        inject: {
          ...inject,
          ui: [
            {
              id: "main",
              placement: "page",
              readsState: null,
              modelVisible: "none",
              mode: "native",
            },
            {
              id: "graph",
              placement: "panel",
              readsState: null,
              modelVisible: "none",
              mode: "app",
              app: { reason: "Needs a canvas", capabilities: ["files", "files", "secrets"] },
            },
            { id: "start", placement: "command", readsState: null, modelVisible: "none" },
          ],
        },
      },
    });
    expect(facts.screens).toEqual([
      { id: "main", placement: "page", mode: "native", reason: null, capabilities: [] },
      {
        id: "graph",
        placement: "panel",
        mode: "app",
        reason: "Needs a canvas",
        capabilities: ["files", "secrets"],
      },
      { id: "start", placement: "command", mode: null, reason: null, capabilities: [] },
    ]);
    expect(facts.gives).toContainEqual({ kind: "ui", count: 3 });
  });

  test("a card without UI declarations has no screen lines", () => {
    expect(workFactsOf(sample("rvw_sample_rule").card).screens).toEqual([]);
  });
});

describe("changeWhatOf: 엔진 차이 열쇠를 부품과 이름으로", () => {
  test("주입 칸의 열쇠는 부품 말과 이름으로 나뉜다", () => {
    expect(changeWhatOf("script:count")).toEqual({ part: "script", name: "count" });
    expect(changeWhatOf("tool:fetch_many")).toEqual({ part: "tool", name: "fetch_many" });
    expect(changeWhatOf("mcp:fetch")).toEqual({ part: "mcp", name: "fetch" });
    expect(changeWhatOf("instruction:AGENTS.md")).toEqual({
      part: "instruction",
      name: "AGENTS.md",
    });
  });

  test("Drive 명령과 이름 없는 열쇠", () => {
    expect(changeWhatOf("drive:command:plan")).toEqual({ part: "command", name: "plan" });
    expect(changeWhatOf("drive:start")).toEqual({ part: "driveStart", name: "" });
    expect(changeWhatOf("runs:code")).toEqual({ part: "runsCode", name: "" });
    expect(changeWhatOf("runs:isolated")).toEqual({ part: "runsIsolated", name: "" });
  });

  test("모르는 열쇠와 이름이 빈 열쇠는 받은 그대로 둔다", () => {
    expect(changeWhatOf("widget:x")).toEqual({ part: null, name: "widget:x" });
    expect(changeWhatOf("tool:")).toEqual({ part: null, name: "tool:" });
  });
});
