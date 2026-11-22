import { describe, expect, test } from "bun:test";
import type { CardDependency } from "@fresnel/contracts/extensions";
import type { DependencyInfo } from "@fresnel/contracts/services";
import type { ExtListPlugin } from "@fresnel/contracts/wire";
import type { CommandError } from "../../../src/views/commands.ts";
import {
  cardProblemText,
  dependencyChangeOf,
  dependencyIssueTextOf,
  dependentRowsOf,
  dependsOnRowsOf,
  depsEditFailureText,
  disabledFixOf,
  partyNameOf,
  rangeProblemOf,
  refusalProblemText,
  requiredByCoreOf,
  splitRegistration,
  targetOptionsOf,
} from "../../../src/views/craft/deps/deps-model.ts";
import { entry } from "../workbench/support.tsx";

// 의존(AGE-33)의 순수 모델. 카드 값, 원본 선언, 거절 오류를 화면의 줄과 말 이름으로 옮기는 것을 값으로 본다.
// 말은 번역하지 않고 메시지 id로 견준다(화면이 `t`로 옮긴다).

function dep(from: string, target: string, over: Partial<CardDependency> = {}): CardDependency {
  return { from, target, kind: "hard", range: null, problem: null, ...over };
}

function declared(
  from: string,
  target: string,
  over: Partial<DependencyInfo> = {},
): DependencyInfo {
  return { from, target, kind: "hard", range: null, ...over };
}

function root(name: string): ExtListPlugin {
  return { registrationId: name, layer: "L3", status: "enabled", inOrchestration: false };
}

function member(name: string, id: string): ExtListPlugin {
  return {
    registrationId: `${name}/${id}`,
    id,
    layer: "L3",
    status: "enabled",
    inOrchestration: true,
  };
}

describe("splitRegistration: Registration id를 이름과 멤버로", () => {
  test("플러그인 전체면 멤버는 null이고, 멤버 id는 첫 슬래시 뒤 전부다", () => {
    expect(splitRegistration("a")).toEqual({ plugin: "a", member: null });
    expect(splitRegistration("a/b")).toEqual({ plugin: "a", member: "b" });
  });
});

describe("partyNameOf: 목록에서 보이는 이름", () => {
  const entries = [entry("web", { displayName: "웹 검색" })];

  test("목록에 있으면 보이는 이름을, 없으면 이름 그대로를 쓴다. 멤버는 따로 든다", () => {
    expect(partyNameOf("web", entries)).toEqual({ plugin: "웹 검색", member: null });
    expect(partyNameOf("web/search", entries)).toEqual({ plugin: "웹 검색", member: "search" });
    expect(partyNameOf("ghost/x", entries)).toEqual({ plugin: "ghost", member: "x" });
  });
});

describe("cardProblemText: 카드의 문제 말", () => {
  test("문제 셋은 각자의 말이고, 문제가 없으면 null", () => {
    expect([
      cardProblemText("target_missing"),
      cardProblemText("member_missing"),
      cardProblemText("range_unmet"),
      cardProblemText(null),
    ]).toEqual([
      "desktop.craft.deps.problem.targetMissing",
      "desktop.craft.deps.problem.memberMissing",
      "desktop.craft.deps.problem.rangeUnmet",
      null,
    ]);
  });
});

describe("dependsOnRowsOf: 기대는 줄", () => {
  test("원본 선언이 없으면 카드 값 그대로 줄이 되고, 멤버가 건 줄은 멤버 id를 든다", () => {
    const rows = dependsOnRowsOf(
      [
        dep("kit", "notes", { problem: "target_missing" }),
        dep("kit/guard", "web", { kind: "soft", range: "^1.0.0", problem: "range_unmet" }),
      ],
      null,
    );
    expect(rows).toEqual([
      {
        key: "kit->notes",
        from: "kit",
        target: "notes",
        fromMember: null,
        kind: "hard",
        range: null,
        problem: "desktop.craft.deps.problem.targetMissing",
      },
      {
        key: "kit/guard->web",
        from: "kit/guard",
        target: "web",
        fromMember: "guard",
        kind: "soft",
        range: "^1.0.0",
        problem: "desktop.craft.deps.problem.rangeUnmet",
      },
    ]);
  });

  test("원본 선언이 있으면 선언이 기준이고, 문제는 같은 줄의 카드 값에서 온다. 원본에만 있는 줄은 문제가 없다", () => {
    const rows = dependsOnRowsOf(
      [dep("kit", "notes", { problem: "target_missing" }), dep("kit", "old")],
      [
        declared("kit", "notes", { kind: "soft", range: "^2.0.0" }),
        declared("kit", "web", { range: "^1.0.0" }),
      ],
    );
    expect(rows).toEqual([
      {
        key: "kit->notes",
        from: "kit",
        target: "notes",
        fromMember: null,
        kind: "soft",
        range: "^2.0.0",
        problem: "desktop.craft.deps.problem.targetMissing",
      },
      {
        key: "kit->web",
        from: "kit",
        target: "web",
        fromMember: null,
        kind: "hard",
        range: "^1.0.0",
        problem: null,
      },
    ]);
  });
});

describe("dependentRowsOf: 이 플러그인에 기대는 줄", () => {
  test("기대는 쪽 줄은 카드 값을 그대로 쓰고 문제를 싣지 않는다", () => {
    expect(
      dependentRowsOf([
        dep("web/search", "kit", { kind: "soft", range: null, problem: "target_missing" }),
      ]),
    ).toEqual([
      {
        key: "web/search->kit",
        from: "web/search",
        target: "kit",
        fromMember: "search",
        kind: "soft",
        range: null,
        problem: null,
      },
    ]);
  });
});

describe("targetOptionsOf: 고를 수 있는 대상", () => {
  const entries = [
    entry("kit", { plugins: [root("kit"), member("kit", "guard")] }),
    entry("web", { displayName: "웹 검색", plugins: [root("web"), member("web", "search")] }),
    entry("notes"),
  ];

  test("자기 자신과 자기 멤버는 빼고, 플러그인 전체와 다른 플러그인의 멤버를 든다", () => {
    expect(targetOptionsOf(entries, "kit", [])).toEqual([
      { value: "web", name: { plugin: "웹 검색", member: null } },
      { value: "web/search", name: { plugin: "웹 검색", member: "search" } },
      { value: "notes", name: { plugin: "notes", member: null } },
    ]);
  });

  test("이미 기대는 대상은 뺀다. 멤버 대상 하나를 빼도 그 플러그인 전체 대상은 남는다", () => {
    expect(targetOptionsOf(entries, "kit", ["notes", "web/search"]).map((o) => o.value)).toEqual([
      "web",
    ]);
  });
});

describe("rangeProblemOf: 버전 범위 칸", () => {
  test("비었거나 공백뿐이거나 64자 이하면 문제가 없고, 65자부터 길이 문제다", () => {
    expect([
      rangeProblemOf(""),
      rangeProblemOf("   "),
      rangeProblemOf("^1.0.0"),
      rangeProblemOf("1".repeat(64)),
      rangeProblemOf("1".repeat(65)),
    ]).toEqual([null, null, null, null, "desktop.craft.deps.range.tooLong"]);
  });
});

describe("depsEditFailureText: 의존 편집이 거절된 까닭", () => {
  test("엔진의 첫 사유 코드로 가르고, 사유가 없으면 거절된 폴더 말이나 그 밖의 말이다", () => {
    expect([
      depsEditFailureText({
        kind: "rejected",
        code: -32602,
        reasons: [{ code: "dependency_self" }],
      }),
      depsEditFailureText({
        kind: "rejected",
        code: -32602,
        reasons: [{ code: "dependency_range_invalid" }],
      }),
      depsEditFailureText({
        kind: "rejected",
        code: -32602,
        reasons: [{ code: "dependency_not_found" }],
      }),
      depsEditFailureText({
        kind: "rejected",
        code: -32602,
        reasons: [{ code: "member_not_found" }],
      }),
      depsEditFailureText({ kind: "rejected", code: -32602, issue: "denied: installed copy" }),
      depsEditFailureText({ kind: "rejected", code: -32602, reasons: [{ code: "unknown_key" }] }),
      depsEditFailureText({ kind: "rejected", code: -32602 }),
      depsEditFailureText({ kind: "offline" }),
      depsEditFailureText({ kind: "switching" }),
      depsEditFailureText({ kind: "failed" }),
    ]).toEqual([
      "desktop.craft.deps.fail.self",
      "desktop.craft.deps.fail.rangeInvalid",
      "desktop.craft.deps.fail.notFound",
      "desktop.craft.deps.fail.memberNotFound",
      "desktop.craft.members.fail.denied",
      "desktop.craft.deps.fail.other",
      "desktop.craft.deps.fail.other",
      "desktop.craft.members.fail.offline",
      "desktop.craft.members.fail.switching",
      "desktop.craft.deps.fail.other",
    ]);
  });

  test("잠김, 지원 안 함, 쓸 수 없음도 일반 말이다", () => {
    const locked: CommandError = { kind: "locked", ownerKind: "cli", options: [] };
    expect([
      depsEditFailureText(locked),
      depsEditFailureText({ kind: "unsupported" }),
      depsEditFailureText({ kind: "not_available", command: "ext.removePreview" }),
    ]).toEqual([
      "desktop.craft.deps.fail.other",
      "desktop.craft.deps.fail.other",
      "desktop.craft.deps.fail.other",
    ]);
  });
});

describe("refusalProblemText: 거절 한 줄의 문제 말", () => {
  test("범위가 안 맞으면 찾은 버전과 범위를 말에 넣고, 찾은 버전이나 범위가 없으면 일반 문제 말이다", () => {
    expect(refusalProblemText("range_unmet", "^1.0.0", "0.5.0")).toEqual({
      id: "desktop.craft.deps.item.rangeUnmet",
      values: { found: "0.5.0", range: "^1.0.0" },
    });
    expect(refusalProblemText("range_unmet", "^1.0.0", null)).toEqual({
      id: "desktop.craft.deps.problem.rangeUnmet",
      values: {},
    });
    expect(refusalProblemText("range_unmet", null, "1.0.0")).toEqual({
      id: "desktop.craft.deps.problem.rangeUnmet",
      values: {},
    });
  });

  test("나머지 문제는 값 없이 항목 말 하나다", () => {
    expect([
      refusalProblemText("target_missing", null, null),
      refusalProblemText("member_missing", null, null),
      refusalProblemText("target_disabled", null, null),
      refusalProblemText("depended_on", null, null),
      refusalProblemText("cycle", null, null),
    ]).toEqual([
      { id: "desktop.craft.deps.item.targetMissing", values: {} },
      { id: "desktop.craft.deps.item.memberMissing", values: {} },
      { id: "desktop.craft.deps.item.targetDisabled", values: {} },
      { id: "desktop.craft.deps.item.dependedOn", values: {} },
      { id: "desktop.craft.deps.item.cycle", values: {} },
    ]);
  });
});

describe("dependencyIssueTextOf: 프로필 검사의 의존 이슈 말", () => {
  test("의존 이슈 셋만 말을 주고 나머지 이슈는 null이다", () => {
    expect([
      dependencyIssueTextOf("dependency_missing"),
      dependencyIssueTextOf("dependency_disabled"),
      dependencyIssueTextOf("dependency_range"),
      dependencyIssueTextOf("plugin_unknown"),
    ]).toEqual([
      "desktop.craft.deps.issue.missing",
      "desktop.craft.deps.issue.disabled",
      "desktop.craft.deps.issue.range",
      null,
    ]);
  });
});

describe("disabledFixOf: 꺼진 대상 때문에 막혔을 때의 두 길", () => {
  test("꺼진 대상 이슈만 센다. 대상은 멤버 이름을 떼고 플러그인을 켜고, 기대는 쪽은 뺀다. 같은 이름은 한 번만 든다", () => {
    expect(
      disabledFixOf([
        { code: "dependency_disabled", plugin: "kit", other: "web/search" },
        { code: "dependency_disabled", plugin: "kit", other: "web" },
        { code: "dependency_missing", plugin: "kit", other: "ghost" },
        { code: "dependency_disabled", plugin: "notes", other: "lens" },
        { code: "dependency_disabled", plugin: null, other: null },
      ]),
    ).toEqual({ enable: ["web", "lens"], drop: ["kit", "notes"] });
  });
});

describe("requiredByCoreOf: 엔진이 필요로 하는 플러그인", () => {
  test("필요로 하는 쪽이 있는 플러그인만 이름에서 필요로 하는 쪽 목록으로 간다", () => {
    expect([
      ...requiredByCoreOf([
        { name: "core-tools", requiredByCore: ["compose", "guard"] },
        { name: "notes", requiredByCore: [] },
        { name: "plain" },
      ]),
    ]).toEqual([["core-tools", ["compose", "guard"]]]);
  });
});

describe("dependencyChangeOf: 카드 비교의 의존 줄", () => {
  test("줄의 기대는 쪽과 대상, 자세히의 종류와 범위를 읽는다. 범위 any는 범위 없음이다", () => {
    expect(dependencyChangeOf("dependsOn:kit->notes", "hard, range ^1.0.0")).toEqual({
      from: "kit",
      target: "notes",
      kind: "hard",
      range: "^1.0.0",
    });
    expect(dependencyChangeOf("dependsOn:kit/guard->web", "soft, range any")).toEqual({
      from: "kit/guard",
      target: "web",
      kind: "soft",
      range: null,
    });
  });

  test("의존 줄이 아니거나 모양이 틀리면 null이고, 자세히가 틀리면 종류만 null이다", () => {
    expect([
      dependencyChangeOf("purpose", "hard, range any"),
      dependencyChangeOf("dependsOn:->notes", "hard, range any"),
      dependencyChangeOf("dependsOn:kit->", "hard, range any"),
    ]).toEqual([null, null, null]);
    expect(dependencyChangeOf("dependsOn:kit->notes", "malformed")).toEqual({
      from: "kit",
      target: "notes",
      kind: null,
      range: null,
    });
    expect(dependencyChangeOf("dependsOn:kit->notes", undefined)).toEqual({
      from: "kit",
      target: "notes",
      kind: null,
      range: null,
    });
  });
});
