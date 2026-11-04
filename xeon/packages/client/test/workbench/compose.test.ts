import { describe, expect, test } from "bun:test";
import type { CompositionDecl } from "@fresnel/contracts/extensions";
import type { Profile, WireManifestIssue } from "@fresnel/contracts/wire";
import {
  blockRowsOf,
  choiceOf,
  compositionOf,
  compositionWithPhases,
  coreLockedOf,
  devkitSummaryOf,
  driverChoicesOf,
  flowDraftOf,
  graphPlacementsOf,
  graphSizeOf,
  newGroupDraftOf,
  newGroupNameErrorOf,
  newGroupProblemOf,
  nextNodeIdOf,
  outlineOf,
  runStatesOf,
  scaffoldInputOf,
  startPointsOf,
  targetDirOf,
  withDriver,
  withInitial,
  withNode,
  withNodeText,
  withTransition,
  withoutNode,
  withoutTransition,
  issueSummaryOf,
  issuesByBlockOf,
  issuesByPhaseNodeOf,
  phaseNodeIndexOf,
  phaseRowsOf,
  profileDraftOf,
  profileDraftProblemOf,
  profileInputOf,
  scaffoldInputWithComposition,
  withChoice,
} from "../../src/workbench/index.ts";

const COMPOSITION: CompositionDecl = {
  blocks: [
    {
      id: "detect",
      stage: "detect",
      op: "on",
      title: "신호 감지",
      summary: "턴 신호를 읽어요",
      hooks: ["tool.call.before"],
      consumes: [],
      produces: [{ kind: "state" }, { kind: "post" }],
    },
    { id: "drive", stage: "machine", op: "drive" },
  ],
  phases: {
    initial: "start",
    nodes: [
      { id: "start", kind: "phase", title: "시작" },
      { id: "done", kind: "end" },
    ],
    transitions: [{ from: "start", to: "done", event: "finished", when: "결과가 있을 때" }],
  },
};

const PROFILE: Profile = {
  id: "quiet",
  title: "조용히",
  enable: ["helm"],
  disable: ["web"],
  settings: [{ key: "ext.helm.maxLenses", value: 3 }],
  driver: "helm",
  updatedAt: "2026-11-04T10:00:00Z",
  rev: 4,
};

describe("compositionOf", () => {
  test("group.composition이 있으면 선언을 돌려준다", () => {
    expect(compositionOf({ group: { composition: COMPOSITION } })).toEqual({
      kind: "declared",
      composition: COMPOSITION,
    });
  });
  test("선언이 없거나 group이 없거나 모양이 틀리면 none이다", () => {
    expect(compositionOf({})).toEqual({ kind: "none" });
    expect(compositionOf({ group: {} })).toEqual({ kind: "none" });
    expect(compositionOf({ group: { composition: { blocks: [] } } })).toEqual({ kind: "none" });
    expect(compositionOf({ group: "x" })).toEqual({ kind: "none" });
  });
});

describe("blockRowsOf", () => {
  test("제목이 없으면 id를 쓰고 비어 있는 선택 값은 빈 목록이다", () => {
    expect(blockRowsOf(COMPOSITION)).toEqual([
      {
        id: "detect",
        title: "신호 감지",
        stage: "detect",
        op: "on",
        summary: "턴 신호를 읽어요",
        hooks: ["tool.call.before"],
        consumes: [],
        produces: [
          { kind: "state", recordKind: null },
          { kind: "post", recordKind: null },
        ],
      },
      {
        id: "drive",
        title: "drive",
        stage: "machine",
        op: "drive",
        summary: null,
        hooks: [],
        consumes: [],
        produces: [],
      },
    ]);
  });
});

describe("검사 이슈", () => {
  const duplicate: WireManifestIssue = {
    severity: "error",
    code: "drive_duplicate",
    path: "blocks[1]",
    message: "a",
  };
  const lenses: WireManifestIssue = {
    severity: "warning",
    code: "w",
    path: "group.composition.blocks[0].hooks",
    message: "b",
  };
  const plugins: WireManifestIssue = {
    severity: "error",
    code: "x",
    path: "plugins",
    message: "c",
  };
  const issues = [duplicate, lenses, plugins];
  test("오류와 경고 수를 센다", () => {
    expect(issueSummaryOf(issues)).toEqual({ errors: 2, warnings: 1 });
  });
  test("path의 블록 번호로 블록에 붙이고 번호가 없는 이슈는 어느 블록에도 붙이지 않는다", () => {
    const byBlock = issuesByBlockOf(COMPOSITION, issues);
    expect(byBlock.get("drive")).toEqual([duplicate]);
    expect(byBlock.get("detect")).toEqual([lenses]);
    expect(byBlock.size).toBe(2);
  });
});

describe("phaseRowsOf", () => {
  test("단계마다 나가는 전이를 모으고 시작 단계를 표시한다", () => {
    expect(phaseRowsOf(COMPOSITION)).toEqual([
      {
        id: "start",
        kind: "phase",
        title: "시작",
        initial: true,
        out: [{ to: "done", event: "finished", when: "결과가 있을 때" }],
      },
      { id: "done", kind: "end", title: "done", initial: false, out: [] },
    ]);
  });
  test("단계 선언이 없으면 null이다", () => {
    expect(phaseRowsOf({ blocks: COMPOSITION.blocks })).toBeNull();
  });
});

describe("프로필 편집", () => {
  test("저장된 프로필의 값과 rev를 옮기고 새 프로필은 baseRev가 null이다", () => {
    expect(profileDraftOf(PROFILE)).toEqual({
      id: "quiet",
      title: "조용히",
      enable: ["helm"],
      disable: ["web"],
      settings: [{ key: "ext.helm.maxLenses", value: 3 }],
      driver: "helm",
      baseRev: 4,
    });
    expect(profileDraftOf(null).baseRev).toBeNull();
  });
  test("켜기·끄기·그대로를 바꾸면 반대쪽 목록에서 빠지고 그대로는 어디에도 없다", () => {
    const draft = profileDraftOf(PROFILE);
    expect(choiceOf(draft, "helm")).toBe("on");
    expect(choiceOf(draft, "web")).toBe("off");
    expect(choiceOf(draft, "other")).toBe("keep");
    const swapped = withChoice(withChoice(draft, "helm", "off"), "web", "keep");
    expect(swapped.enable).toEqual([]);
    expect(swapped.disable).toEqual(["helm"]);
    expect(choiceOf(withChoice(swapped, "helm", "keep"), "helm")).toBe("keep");
  });
  test("저장 입력은 이름을 정렬하고 화면이 안 고친 설정·drive를 그대로 보낸다", () => {
    const draft = withChoice(withChoice(profileDraftOf(PROFILE), "zeta", "on"), "alpha", "on");
    expect(profileInputOf({ ...draft, title: "  조용히 " })).toEqual({
      id: "quiet",
      title: "조용히",
      enable: ["alpha", "helm", "zeta"],
      disable: ["web"],
      settings: [{ key: "ext.helm.maxLenses", value: 3 }],
      driver: "helm",
    });
  });
  test("새 프로필은 id 규칙을, 모든 프로필은 이름 입력을 본다", () => {
    const fresh = profileDraftOf(null);
    expect(profileDraftProblemOf(fresh)).toBe("id");
    expect(profileDraftProblemOf({ ...fresh, id: "Bad Id", title: "x" })).toBe("id");
    expect(profileDraftProblemOf({ ...fresh, id: "quiet" })).toBe("title");
    expect(profileDraftProblemOf({ ...fresh, id: "quiet", title: "조용히" })).toBeNull();
    expect(profileDraftProblemOf({ ...profileDraftOf(PROFILE), title: " " })).toBe("title");
    expect(profileDraftProblemOf(profileDraftOf(PROFILE))).toBeNull();
  });
});

const FLOW = {
  initial: "a",
  nodes: [
    { id: "a", kind: "phase" as const, title: "시작" },
    { id: "b", kind: "human" as const },
    { id: "c", kind: "end" as const },
  ],
  transitions: [
    { from: "a", to: "b", event: "ask" },
    { from: "b", to: "c" },
  ],
};

describe("새 그룹 초안", () => {
  const draft = { name: "lens-review", kind: "plugin-group" as const, parentDir: "/work/code/" };

  test("이름 규칙: 빈 값은 오류 없음, 대문자와 한 글자는 pattern", () => {
    expect(newGroupNameErrorOf("")).toBeNull();
    expect(newGroupNameErrorOf("lens-review")).toBeNull();
    expect(newGroupNameErrorOf("Lens")).toBe("pattern");
    expect(newGroupNameErrorOf("a")).toBe("pattern");
    expect(newGroupNameErrorOf("1abc")).toBe("pattern");
  });

  test("막는 까닭은 이름, 종류, 폴더 순이다", () => {
    expect(newGroupProblemOf(newGroupDraftOf())).toBe("name");
    expect(newGroupProblemOf({ ...draft, kind: null })).toBe("kind");
    expect(newGroupProblemOf({ ...draft, parentDir: " " })).toBe("dir");
    expect(newGroupProblemOf(draft)).toBeNull();
  });

  test("대상 폴더는 구분자를 하나만 둔다", () => {
    expect(targetDirOf(draft)).toBe("/work/code/lens-review");
    expect(targetDirOf({ ...draft, parentDir: "" })).toBe("");
  });

  test("scaffold 입력: 그룹 종류는 빈 group 선언을 싣고 단일 플러그인은 싣지 않는다", () => {
    expect(scaffoldInputOf(draft)).toEqual({
      kind: "plugin-group",
      name: "lens-review",
      dir: "/work/code/lens-review",
      group: {},
    });
    expect(scaffoldInputOf({ ...draft, kind: "single-plugin" })).toEqual({
      kind: "single-plugin",
      name: "lens-review",
      dir: "/work/code/lens-review",
    });
    expect(scaffoldInputOf({ ...draft, name: "X" })).toBeNull();
  });

  test("시작점은 stable과 preview만 고를 수 있다", () => {
    const base = {
      layers: [],
      since: "1",
      requires: { contracts: "1" },
      checks: [],
      decisions: [],
      security: [],
    };
    const rows = startPointsOf([
      { ...base, id: "plugin-group", title: "그룹", status: "stable" },
      { ...base, id: "single-plugin", title: "플러그인", status: "blocked" },
    ]);
    expect(rows.map((row) => [row.id, row.selectable])).toEqual([
      ["plugin-group", true],
      ["single-plugin", false],
    ]);
  });

  test("검사 개수는 info를 세지 않는다", () => {
    expect(
      devkitSummaryOf([
        { severity: "error", code: "a", path: "", message: "" },
        { severity: "warning", code: "b", path: "", message: "" },
        { severity: "info", code: "c", path: "", message: "" },
      ]),
    ).toEqual({ errors: 1, warnings: 1 });
  });
});

describe("흐름 초안 편집", () => {
  test("선언이 없으면 초안도 없다", () => {
    expect(flowDraftOf(COMPOSITION)).toEqual(COMPOSITION.phases ?? null);
    expect(flowDraftOf({ blocks: [] })).toBeNull();
  });

  test("노드 id는 겹치지 않는다", () => {
    expect(nextNodeIdOf(FLOW, "turn")).toBe("turn-1");
    const next = withNode(FLOW, "turn");
    expect(next.nodes.at(-1)).toEqual({ id: "turn-1", kind: "turn" });
    expect(nextNodeIdOf(next, "turn")).toBe("turn-2");
  });

  test("노드를 지우면 전이도 지우고, 시작 노드를 지우면 첫 노드가 시작이 된다", () => {
    const next = withoutNode(FLOW, "a");
    expect(next.initial).toBe("b");
    expect(next.nodes.map((node) => node.id)).toEqual(["b", "c"]);
    expect(next.transitions).toEqual([{ from: "b", to: "c" }]);
  });

  test("마지막 노드는 지우지 않는다", () => {
    const one = { initial: "a", nodes: [{ id: "a", kind: "end" as const }], transitions: [] };
    expect(withoutNode(one, "a")).toBe(one);
  });

  test("시작 노드는 있는 노드로만 바꾼다", () => {
    expect(withInitial(FLOW, "c").initial).toBe("c");
    expect(withInitial(FLOW, "zz")).toBe(FLOW);
  });

  test("제목은 비우면 사라지고 askTitle은 사람 확인 노드에만 남는다", () => {
    const a = withNodeText(FLOW, "a", { title: "  " });
    expect(a.nodes[0]).toEqual({ id: "a", kind: "phase" });
    const b = withNodeText(FLOW, "b", { askTitle: " 적용할까요? " });
    expect(b.nodes[1]).toEqual({ id: "b", kind: "human", askTitle: "적용할까요?" });
    const notHuman = withNodeText(FLOW, "a", { askTitle: "x" });
    expect(notHuman.nodes[0]).toEqual({ id: "a", kind: "phase", title: "시작" });
  });

  test("전이: 자기 자신, 없는 노드, 중복은 그대로", () => {
    expect(withTransition(FLOW, "a", "a")).toBe(FLOW);
    expect(withTransition(FLOW, "a", "zz")).toBe(FLOW);
    expect(withTransition(FLOW, "a", "b")).toBe(FLOW);
    expect(withTransition(FLOW, "a", "c").transitions.at(-1)).toEqual({ from: "a", to: "c" });
    expect(withoutTransition(FLOW, "a", "b").transitions).toEqual([{ from: "b", to: "c" }]);
  });

  test("초안을 구성에 되돌린다", () => {
    expect(compositionWithPhases(COMPOSITION, FLOW).phases).toBe(FLOW);
    expect(compositionWithPhases(COMPOSITION, FLOW).blocks).toBe(COMPOSITION.blocks);
  });
});

describe("캔버스 자리와 개요", () => {
  test("깊이는 열, 같은 열의 순서는 행이다. 닿지 않는 노드는 오른쪽 끝 뒤", () => {
    const flow = {
      ...FLOW,
      nodes: [...FLOW.nodes, { id: "d", kind: "turn" as const }, { id: "e", kind: "end" as const }],
      transitions: [...FLOW.transitions, { from: "a", to: "d" }],
    };
    expect(graphPlacementsOf(flow)).toEqual([
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 232, y: 0 },
      { id: "c", x: 464, y: 0 },
      { id: "d", x: 232, y: 96 },
      { id: "e", x: 696, y: 0 },
    ]);
  });

  test("캔버스 크기는 가장 먼 노드를 감싼다", () => {
    expect(graphSizeOf(graphPlacementsOf(FLOW))).toEqual({ width: 464 + 168 + 32, height: 112 });
  });

  test("개요: 노드 다음에 나가는 전이가 들여 쓰인다", () => {
    expect(outlineOf(FLOW).map((row) => [row.id, row.depth, row.label, row.target])).toEqual([
      ["node:a", 0, "시작", null],
      ["edge:a>b", 1, "ask", "b"],
      ["node:b", 0, "b", null],
      ["edge:b>c", 1, "c", "c"],
      ["node:c", 0, "c", null],
    ]);
  });

  test("지금 단계: 앞 열은 done, 뒤 열은 idle, 모르면 모두 idle", () => {
    expect([...runStatesOf(FLOW, "b")]).toEqual([
      ["a", "done"],
      ["b", "active"],
      ["c", "idle"],
    ]);
    expect([...runStatesOf(FLOW, null).values()]).toEqual(["idle", "idle", "idle"]);
    expect([...runStatesOf(FLOW, "nope").values()]).toEqual(["idle", "idle", "idle"]);
  });
});

describe("프로필의 drive 그룹과 코어 잠금", () => {
  test("빈 값은 자동(null)", () => {
    const draft = profileDraftOf(null);
    expect(withDriver(draft, "helm").driver).toBe("helm");
    expect(withDriver({ ...draft, driver: "helm" }, "  ").driver).toBeNull();
    expect(withDriver(draft, null).driver).toBeNull();
  });

  test("저장 입력에 driver가 실린다", () => {
    const draft = withDriver({ ...profileDraftOf(null), id: "p1", title: "t" }, "helm");
    expect(profileInputOf(draft).driver).toBe("helm");
  });

  test("코어 잠금은 core tier나 내장이다", () => {
    expect(coreLockedOf({ tier: "core" })).toBe(true);
    expect(coreLockedOf({ tier: null, origin: "builtin" })).toBe(true);
    expect(coreLockedOf({ tier: null, origin: "user" })).toBe(false);
  });

  test("drive 후보는 그룹만, 이름 순", () => {
    expect(
      driverChoicesOf([
        { name: "z", isGroup: true },
        { name: "p", isGroup: false },
        { name: "a", isGroup: true },
      ]),
    ).toEqual(["a", "z"]);
  });
});

/** 단계 선언 검사 이슈 한 건 */
function phaseIssueAt(path: string, message: string): WireManifestIssue {
  return { severity: "error", code: "phase_invalid", path, message };
}

describe("구성 초안의 scaffold 입력과 단계 노드 이슈", () => {
  const draft = {
    name: "lens-review",
    kind: "plugin-group" as const,
    parentDir: "/work/code",
  };

  test("플러그인 그룹이면 고친 구성 선언을 group.composition으로 싣는다", () => {
    expect(scaffoldInputWithComposition(draft, COMPOSITION)).toEqual({
      kind: "plugin-group",
      name: "lens-review",
      dir: "/work/code/lens-review",
      group: { composition: COMPOSITION },
    });
  });

  test("다른 종류는 구성을 싣지 않고, 이름이나 폴더가 비면 null이다", () => {
    expect(scaffoldInputWithComposition({ ...draft, kind: "single-plugin" }, COMPOSITION)).toEqual({
      kind: "single-plugin",
      name: "lens-review",
      dir: "/work/code/lens-review",
    });
    expect(scaffoldInputWithComposition({ ...draft, name: "X" }, COMPOSITION)).toBeNull();
    expect(scaffoldInputWithComposition({ ...draft, parentDir: "" }, COMPOSITION)).toBeNull();
  });

  test("단계 노드 번호는 /phases/nodes/<번호>에서만 읽는다", () => {
    expect(phaseNodeIndexOf("/phases/nodes/2")).toBe(2);
    expect(phaseNodeIndexOf("/phases/nodes/0/id")).toBe(0);
    expect(phaseNodeIndexOf("/phases/nodes/12/kind")).toBe(12);
    expect(phaseNodeIndexOf("/phases/transitions/0/from")).toBeNull();
    expect(phaseNodeIndexOf("/phases/initial")).toBeNull();
    expect(phaseNodeIndexOf("/phases")).toBeNull();
    expect(phaseNodeIndexOf("/blocks/0")).toBeNull();
    expect(phaseNodeIndexOf("/phases/nodesX/1")).toBeNull();
  });

  test("노드 이슈는 번호가 가리키는 노드 id에 붙고, 목록 밖 번호는 버린다", () => {
    const flow = {
      initial: "start",
      nodes: [
        { id: "start", kind: "phase" as const },
        { id: "gate", kind: "human" as const },
      ],
      transitions: [],
    };
    const byNode = issuesByPhaseNodeOf(flow, [
      phaseIssueAt("/phases/nodes/1/id", "중복"),
      phaseIssueAt("/phases/nodes/1", "도달 못 함"),
      phaseIssueAt("/phases/nodes/9", "목록 밖"),
      phaseIssueAt("/phases/initial", "시작 없음"),
    ]);
    expect(byNode.get("gate")).toEqual([
      phaseIssueAt("/phases/nodes/1/id", "중복"),
      phaseIssueAt("/phases/nodes/1", "도달 못 함"),
    ]);
    expect(byNode.get("start")).toBeUndefined();
    expect(byNode.size).toBe(1);
  });
});

describe("블록 이슈의 경로 모양", () => {
  test("검사기의 JSON Pointer 경로(/blocks/1)도 블록에 붙는다", () => {
    const issue: WireManifestIssue = {
      severity: "error",
      code: "drive_duplicate",
      path: "/group/composition/blocks/1",
      message: "m",
    };
    expect([...issuesByBlockOf(COMPOSITION, [issue])]).toEqual([["drive", [issue]]]);
  });
});
