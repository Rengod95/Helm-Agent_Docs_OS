import { describe, expect, test } from "bun:test";
import type { CompositionDecl } from "@fresnel/contracts/extensions";
import type { Profile, WireManifestIssue } from "@fresnel/contracts/wire";
import {
  blockRowsOf,
  choiceOf,
  compositionOf,
  issueSummaryOf,
  issuesByBlockOf,
  phaseRowsOf,
  profileDraftOf,
  profileDraftProblemOf,
  profileInputOf,
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
