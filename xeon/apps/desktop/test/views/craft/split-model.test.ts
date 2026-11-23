import { describe, expect, test } from "bun:test";
import type { CardDependency, PluginCard } from "@fresnel/contracts/extensions";
import type { DevkitIssue, MemberInfo } from "@fresnel/contracts/services";
import type { CommandError } from "../../../src/views/commands.ts";
import {
  childDirOf,
  defaultDetachName,
  detachPlanOf,
  extensionNameOf,
  mergeCandidatesOf,
  mergeDependentsOf,
  newNameProblemOf,
  purposeProblemOf,
  siblingDirOf,
  splitFailureText,
  splitNotesOf,
  swapOutOf,
} from "../../../src/views/craft/members/split-model.ts";
import { entry } from "../workbench/support.tsx";

// 멤버 떼기와 플러그인 합치기의 순수 모델. 이름과 경로의 기본값, 거절 사유와 결과 알림을 사람 말로 옮기는 것, 합치기 후보를 값으로 본다.

function issue(severity: DevkitIssue["severity"], code: string): DevkitIssue {
  return { severity, code, path: "", message: "" };
}

function reasonOf(code: string): CommandError {
  return { kind: "rejected", code: -32602, reasons: [{ code }] };
}

function member(id: string, over: Partial<MemberInfo> = {}): MemberInfo {
  return {
    id,
    registrationId: `group/${id}`,
    title: null,
    layer: "plugin",
    hooks: [],
    drives: false,
    defaultEnabled: true,
    blockIds: [],
    injects: [],
    tools: [],
    ...over,
  };
}

describe("newNameProblemOf: 새 플러그인 이름", () => {
  test("비었으면 아직 묻지 않고, 규칙(소문자로 시작, 2~32자)과 설치된 이름 겹침을 본다", () => {
    expect([
      newNameProblemOf("", ["kit"]),
      newNameProblemOf("Bad", ["kit"]),
      newNameProblemOf("a", []),
      newNameProblemOf("a".repeat(33), []),
      newNameProblemOf("kit", ["kit"]),
      newNameProblemOf("guard", ["kit"]),
      newNameProblemOf("a".repeat(32), []),
    ]).toEqual([
      null,
      "desktop.craft.split.name.invalid",
      "desktop.craft.split.name.invalid",
      "desktop.craft.split.name.invalid",
      "desktop.craft.split.name.taken",
      null,
      null,
    ]);
  });
});

describe("defaultDetachName: 떼기의 새 이름 기본값", () => {
  test("`<원래 이름>-<멤버 id>`이다", () => {
    expect(defaultDetachName("kit", "guard")).toBe("kit-guard");
  });

  test("이름 한도 32자에서 자르고, 자른 끝에 하이픈이 남으면 뗀다", () => {
    expect(defaultDetachName("a".repeat(40), "x")).toBe("a".repeat(32));
    expect(defaultDetachName("a".repeat(31), "bc")).toBe("a".repeat(31));
  });
});

describe("siblingDirOf: 원본 옆의 새 폴더", () => {
  test("같은 부모 아래에 새 이름을 두고, 끝 슬래시와 Windows 구분자를 따른다", () => {
    expect([
      siblingDirOf("/a/b/src", "new"),
      siblingDirOf("/a/b/src/", "new"),
      siblingDirOf("C:\\x\\y", "new"),
      siblingDirOf("src", "new"),
    ]).toEqual(["/a/b/new", "/a/b/new", "C:\\x\\new", "new"]);
  });
});

describe("childDirOf: 고른 부모 폴더 안의 새 폴더", () => {
  test("부모의 구분자를 따르고, 끝 구분자는 한 번만 센다", () => {
    expect([
      childDirOf("/a/b", "new"),
      childDirOf("/a/b/", "new"),
      childDirOf("C:\\x", "new"),
      childDirOf("C:\\x\\", "new"),
    ]).toEqual(["/a/b/new", "/a/b/new", "C:\\x\\new", "C:\\x\\new"]);
  });
});

describe("purposeProblemOf: 목적 한 문장", () => {
  test("공백을 떼고 200자 이하면 문제가 없고, 넘으면 길이 문제다", () => {
    expect([
      purposeProblemOf("a".repeat(200)),
      purposeProblemOf(`  ${"a".repeat(200)}  `),
      purposeProblemOf("a".repeat(201)),
    ]).toEqual([null, null, "desktop.craft.split.purpose.tooLong"]);
  });
});

describe("splitFailureText: 떼기와 합치기가 거절된 까닭", () => {
  test("거절 사유 코드마다 말이 있다", () => {
    expect([
      splitFailureText(reasonOf("out_dir_not_empty")),
      splitFailureText(reasonOf("out_dir_inside_source")),
      splitFailureText(reasonOf("name_invalid")),
      splitFailureText(reasonOf("name_conflict")),
      splitFailureText(reasonOf("member_not_found")),
      splitFailureText(reasonOf("capability_duplicate")),
      splitFailureText(reasonOf("replace_conflict")),
      splitFailureText(reasonOf("member_id_conflict")),
      splitFailureText(reasonOf("source_has_members")),
      splitFailureText(reasonOf("source_duplicate_name")),
      splitFailureText(reasonOf("tool_duplicate")),
      splitFailureText(reasonOf("layer_mixed_external")),
    ]).toEqual([
      "desktop.craft.split.fail.outDirNotEmpty",
      "desktop.craft.split.fail.outDirInside",
      "desktop.craft.split.name.invalid",
      "desktop.craft.split.name.taken",
      "desktop.craft.members.fail.notFound",
      "desktop.craft.split.fail.capabilityDuplicate",
      "desktop.craft.split.fail.replaceConflict",
      "desktop.craft.split.fail.memberIdConflict",
      "desktop.craft.split.fail.sourceHasMembers",
      "desktop.craft.split.fail.sourceDuplicate",
      "desktop.craft.split.fail.toolDuplicate",
      "desktop.craft.split.fail.layerMixed",
    ]);
  });

  test("권한 거절은 denied 말, 모르는 사유와 나머지 실패는 일반 말이고, 연결 끊김과 바꾸는 중은 공통 말이다", () => {
    expect([
      splitFailureText({ kind: "rejected", code: -32602, issue: "denied: installed copy" }),
      splitFailureText(reasonOf("unknown_key")),
      splitFailureText({ kind: "rejected", code: -32602 }),
      splitFailureText({ kind: "failed" }),
      splitFailureText({ kind: "unsupported" }),
      splitFailureText({ kind: "offline" }),
      splitFailureText({ kind: "switching" }),
    ]).toEqual([
      "desktop.craft.members.fail.denied",
      "desktop.craft.split.fail.other",
      "desktop.craft.split.fail.other",
      "desktop.craft.split.fail.other",
      "desktop.craft.split.fail.other",
      "desktop.craft.members.fail.offline",
      "desktop.craft.members.fail.switching",
    ]);
  });
});

describe("splitNotesOf: 결과 알림", () => {
  test("경고가 먼저 오고, 같은 말은 한 번만 든다. 떼기와 합치기의 공유 파일 알림은 한 줄이다", () => {
    expect(
      splitNotesOf([
        issue("info", "detach_shared_files_not_copied"),
        issue("warning", "detach_code_needs_wiring"),
        issue("info", "merge_shared_files_not_copied"),
        issue("info", "unknown_info_code"),
      ]),
    ).toEqual([
      { tone: "warning", text: "desktop.craft.split.note.detachWiring" },
      { tone: "info", text: "desktop.craft.split.note.sharedFiles" },
    ]);
  });

  test("모르는 경고는 '엔진 경고가 더 있어요' 한 줄로 모으고, 모르는 알림은 아무것도 더하지 않는다", () => {
    expect(splitNotesOf([issue("info", "mystery_info")])).toEqual([]);
    expect(
      splitNotesOf([issue("warning", "mystery_warning"), issue("warning", "mystery_two")]),
    ).toEqual([{ tone: "warning", text: "desktop.craft.split.note.otherWarning" }]);
  });
});

describe("mergeCandidatesOf: 합칠 수 있는 후보", () => {
  test("내장이 아니고 외부 층이며 오케스트레이션 선언이 없고 멤버가 없는 Registration 하나짜리 플러그인만 든다", () => {
    const candidates = mergeCandidatesOf([
      entry("core-loop", { origin: "builtin", layer: "plugin" }),
      entry("solo", { layer: "plugin" }),
      entry("layered"),
      entry("pair", {
        plugins: [
          { registrationId: "pair", layer: "L3", status: "enabled", inOrchestration: false },
          {
            registrationId: "pair/guard",
            id: "guard",
            layer: "L3",
            status: "enabled",
            inOrchestration: true,
          },
        ],
      }),
      entry("solo-member", {
        plugins: [
          {
            registrationId: "solo-member/guard",
            id: "guard",
            layer: "L3",
            status: "enabled",
            inOrchestration: true,
          },
        ],
      }),
      entry("driver", { layer: "plugin", isOrchestration: true }),
    ]);
    expect(candidates.map((e) => e.name)).toEqual(["solo"]);
  });
});

/** 의존 칸만 채운 카드 */
function depCard(name: string, dependsOn: readonly CardDependency[] = []): PluginCard {
  return {
    name,
    displayName: name,
    purpose: null,
    does: { inject: null, hook: null, drive: null },
    enforcement: "advisory",
    runs: { code: false, isolated: null },
    cost: { always: null, drive: null, onDemand: null, toolCount: null, basis: "unknown" },
    health: { state: "ok", lastActiveAt: null, lastError: null },
    origin: { kind: "user" },
    review: { state: "approved", currentHash: null, pendingItemId: null, approvedAt: null },
    usedBy: [],
    dependencies: { dependsOn, dependents: [] },
  };
}

function dep(from: string, target: string, kind: CardDependency["kind"]): CardDependency {
  return { from, target, kind, range: null, problem: null };
}

describe("mergeDependentsOf: 합칠 원본에 꼭 기대는 플러그인(plugWire)", () => {
  const cards = [
    depCard("a"),
    depCard("b"),
    depCard("c"),
    // hard로 a에 기댄다(구성원 id가 붙은 대상도 확장 이름으로 읽는다)
    depCard("user1", [dep("user1", "a/inner", "hard")]),
    // soft는 막지 않는다
    depCard("user2", [dep("user2", "a", "soft"), dep("user2", "b", "hard")]),
    // 고른 것끼리의 의존은 세지 않는다
    depCard("c-dep", [dep("c-dep", "c", "hard")]),
  ];

  test("고른 원본마다 hard로 기대는, 고르지 않은 플러그인을 고른 순서대로 준다", () => {
    expect(mergeDependentsOf(["b", "a"], cards)).toEqual([
      { source: "b", dependents: ["user2"] },
      { source: "a", dependents: ["user1"] },
    ]);
  });

  test("기대는 플러그인을 같이 고르면 알림이 없고, 아무도 기대지 않으면 빈 목록이다", () => {
    expect(mergeDependentsOf(["a", "user1"], cards)).toEqual([]);
    expect(mergeDependentsOf(["c", "c-dep"], cards)).toEqual([]);
    expect(mergeDependentsOf(["c", "b"], [depCard("c"), depCard("b")])).toEqual([]);
  });
});

describe("프로필 계획의 값(AGE-72)", () => {
  test("확장 이름은 `/` 앞이고, 합치기가 뺄 이름은 중복 없이 선언 순서다", () => {
    expect(extensionNameOf("alpha/guard")).toBe("alpha");
    expect(extensionNameOf("alpha")).toBe("alpha");
    expect(
      swapOutOf([
        { from: "beta" },
        { from: "alpha/guard" },
        { from: "beta/lead" },
        { from: "alpha" },
      ]),
    ).toEqual(["beta", "alpha"]);
  });

  test("떼기에서 남는 구성원이 있으면 묶음 바로 뒤에 들고 묶음은 남는다. 떼는 구성원이 혼자 Drive면 Drive를 옮긴다", () => {
    const members = [member("guard"), member("lead", { drives: true }), member("notes")];
    expect(detachPlanOf(members, "lead", "group")).toEqual({
      profilePlan: { swapOut: [], placeAfter: "group", driveFrom: "group" },
      bundleStays: true,
    });
    expect(detachPlanOf(members, "guard", "group").profilePlan.driveFrom).toBe(null);
  });

  test("떼고 나면 구성원이 없으면 묶음이 프로필에서 빠지고(swapOut) 묶음 폴더는 다시 내지 않는다", () => {
    expect(detachPlanOf([member("lead")], "lead", "group")).toEqual({
      profilePlan: { swapOut: ["group"], placeAfter: null, driveFrom: null },
      bundleStays: false,
    });
  });
});
