import { describe, expect, test } from "bun:test";
import type { MemberInfo } from "@fresnel/contracts/services";
import type { ReviewItem } from "@fresnel/contracts/wire";
import type { CommandError } from "../../../src/views/commands.ts";
import {
  accessOf,
  blockTitlesOf,
  driveAllowedOf,
  editFailureText,
  hasMembers,
  idProblemOf,
  isDenied,
  keptFilesOf,
  keyMoveOf,
  memberRowsOf,
  membersOfManifest,
  movedOrder,
  pendingItemOf,
  rootLayerOf,
  sendStateOf,
} from "../../../src/views/craft/members/members-model.ts";
import { sampleItems } from "../../../src/views/craft/review/testing/review-samples.ts";
import { entry } from "../workbench/support.tsx";

// 구성원 탭의 순수 모델(m6Mb). 설치본 매니페스트 읽기, 줄 모양, 고칠 수 있는지, 리뷰와의 관계, 순서 바꾸기, 편집 실패 문장을 값으로 본다.

const MANIFEST: Readonly<Record<string, unknown>> = {
  name: "kit",
  plugins: [
    { layer: "L3", hooks: ["boundary.settle.after"] },
    {
      id: "guard",
      layer: "L3",
      title: "Test guard",
      hooks: ["tool.call.before", "lifecycle.agent.settled"],
    },
    { id: "lead", layer: "L3", hooks: [], drives: true, defaultEnabled: true },
    { id: "notes", layer: "L3", hooks: [] },
    { id: 7, layer: "L3", hooks: [] },
  ],
  orchestration: {
    composition: {
      blocks: [{ id: "plan", title: "Plan steps", stage: "plan", op: "post", plugin: "lead" }],
    },
  },
};

function info(id: string, over: Partial<MemberInfo> = {}): MemberInfo {
  return {
    id,
    registrationId: `kit/${id}`,
    title: null,
    layer: "L3",
    hooks: [],
    drives: false,
    defaultEnabled: false,
    blockIds: [],
    ...over,
  };
}

const BASE_ITEM = sampleItems()[0];

/** 표본 리뷰 항목 하나에서 이 시험이 읽는 칸(itemId, name, state)만 바꾼다 */
function reviewItem(itemId: string, name: string, state: ReviewItem["state"]): ReviewItem {
  if (BASE_ITEM === undefined) throw new Error("the review samples are empty");
  return { ...BASE_ITEM, itemId, name, state };
}

describe("membersOfManifest: 설치본 매니페스트의 구성원", () => {
  test("뿌리와 모양이 틀린 항목은 빼고, 블록은 plugin이 그 구성원인 것만 든다", () => {
    expect(membersOfManifest("kit", MANIFEST)).toEqual([
      info("guard", {
        title: "Test guard",
        hooks: ["tool.call.before", "lifecycle.agent.settled"],
      }),
      info("lead", { drives: true, defaultEnabled: true, blockIds: ["plan"] }),
      info("notes"),
    ]);
  });

  test("plugins가 없으면 빈 목록", () => {
    expect(membersOfManifest("kit", { name: "kit" })).toEqual([]);
  });
});

describe("memberRowsOf: 줄 하나의 모양", () => {
  test("종류는 Drive가 먼저, Hook 자리는 사용자 말, 이름표 없는 훅은 수로, 블록은 제목으로", () => {
    const rows = memberRowsOf(
      [
        info("guard", {
          title: "Test guard",
          hooks: ["tool.call.before", "lifecycle.agent.settled"],
        }),
        info("lead", {
          drives: true,
          hooks: ["boundary.settle.after"],
          blockIds: ["plan", "gone"],
        }),
        info("notes"),
      ],
      new Map([["plan", "Plan steps"]]),
    );
    expect(rows).toEqual([
      {
        id: "guard",
        name: "Test guard",
        hasTitle: true,
        kinds: ["hook"],
        moments: ["desktop.craft.detail.moment.tool.call.before"],
        otherHooks: 1,
        blocks: [],
      },
      {
        id: "lead",
        name: "lead",
        hasTitle: false,
        kinds: ["drive", "hook"],
        moments: ["desktop.craft.detail.moment.boundary.settle.after"],
        otherHooks: 0,
        blocks: [
          { id: "plan", title: "Plan steps" },
          { id: "gone", title: "gone" },
        ],
      },
      {
        id: "notes",
        name: "notes",
        hasTitle: false,
        kinds: [],
        moments: [],
        otherHooks: 0,
        blocks: [],
      },
    ]);
  });

  test("blockTitlesOf는 구성 선언의 블록 제목을 id로 찾는다", () => {
    expect([...blockTitlesOf(MANIFEST)]).toEqual([["plan", "Plan steps"]]);
    expect([...blockTitlesOf({ name: "kit" })]).toEqual([]);
  });
});

describe("구성원이 있는지와 뿌리의 층", () => {
  test("id가 있는 Registration이 있으면 구성원이 있다", () => {
    const plain = entry("kit");
    const multi = entry("kit", {
      plugins: [
        { registrationId: "kit", layer: "L3", status: "enabled", inOrchestration: true },
        {
          registrationId: "kit/guard",
          id: "guard",
          layer: "L3",
          status: "enabled",
          inOrchestration: true,
        },
      ],
    });
    expect([hasMembers(plain), hasMembers(multi)]).toEqual([false, true]);
    expect([rootLayerOf(plain), rootLayerOf(multi)]).toEqual(["L2", "L3"]);
    expect([driveAllowedOf("L3"), driveAllowedOf("plugin"), driveAllowedOf(null)]).toEqual([
      true,
      false,
      false,
    ]);
  });
});

describe("accessOf: 고칠 수 있는가", () => {
  test("내장, 원본 폴더 없음, 엔진이 거절함, 고칠 수 있음", () => {
    expect([
      accessOf(entry("kit", { origin: "builtin" }), "/src/kit", false),
      accessOf(entry("kit"), null, false),
      accessOf(entry("kit"), "/src/kit", true),
      accessOf(entry("kit"), "/src/kit", false),
    ]).toEqual([
      { kind: "locked", reason: "builtin" },
      { kind: "locked", reason: "noSource" },
      { kind: "locked", reason: "denied" },
      { kind: "editable", dir: "/src/kit" },
    ]);
  });
});

describe("리뷰와의 관계", () => {
  const waiting = reviewItem("i2", "kit", "pending");
  test("대기 항목이 있으면 inReview, 보낸 뒤 또 고쳤으면 changed, 승인본과 같으면 clean", () => {
    expect([
      sendStateOf({ matchesReviewed: false, pending: waiting, editedSinceSend: false }),
      sendStateOf({ matchesReviewed: false, pending: waiting, editedSinceSend: true }),
      sendStateOf({ matchesReviewed: false, pending: null, editedSinceSend: false }),
      sendStateOf({ matchesReviewed: true, pending: null, editedSinceSend: false }),
    ]).toEqual([
      { kind: "inReview", itemId: "i2" },
      { kind: "changed" },
      { kind: "changed" },
      { kind: "clean" },
    ]);
  });

  test("pendingItemOf는 이 이름의 대기 항목 가운데 마지막 것", () => {
    const items = [
      reviewItem("i1", "kit", "pending"),
      reviewItem("x", "other", "pending"),
      reviewItem("i0", "kit", "approved"),
      waiting,
    ];
    expect(pendingItemOf(items, "kit")?.itemId).toBe("i2");
    expect(pendingItemOf(items, "none")).toBeNull();
  });
});

describe("이름 검사", () => {
  test("규칙, 중복, 빈 값", () => {
    expect([
      idProblemOf("", ["kit"]),
      idProblemOf("Bad", ["kit"]),
      idProblemOf("kit", ["kit"]),
      idProblemOf("guard", ["kit"]),
    ]).toEqual([
      null,
      "desktop.craft.members.id.pattern",
      "desktop.craft.members.id.duplicate",
      null,
    ]);
  });
});

describe("순서", () => {
  test("movedOrder는 옮긴 뒤 자리로 넣는다. 범위 밖은 그대로", () => {
    expect(movedOrder(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(movedOrder(["a", "b", "c", "d"], 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(movedOrder(["a", "b"], 0, 5)).toEqual(["a", "b"]);
  });

  test("keyMoveOf: 줄에서는 Alt+화살표만, 집은 동안은 화살표와 Home·End", () => {
    expect([
      keyMoveOf("ArrowDown", false, false, 1, 4),
      keyMoveOf("ArrowDown", true, false, 1, 4),
      keyMoveOf("ArrowUp", true, false, 0, 4),
      keyMoveOf("Home", true, false, 2, 4),
      keyMoveOf("ArrowUp", false, true, 2, 4),
      keyMoveOf("Home", false, true, 2, 4),
      keyMoveOf("End", false, true, 2, 4),
      keyMoveOf("End", false, true, 3, 4),
      keyMoveOf("x", false, true, 1, 4),
    ]).toEqual([null, 2, null, null, 1, 0, 3, null, null]);
  });
});

describe("편집 결과와 실패", () => {
  test("남긴 코드 파일은 member_file_kept 알림의 파일", () => {
    expect(
      keptFilesOf([
        {
          severity: "info",
          code: "member_file_kept",
          path: "",
          file: "src/members/tap.ts",
          message: "",
        },
        { severity: "warning", code: "other", path: "", file: "x.ts", message: "" },
      ]),
    ).toEqual(["src/members/tap.ts"]);
  });

  test("입력 거절은 엔진의 종류로 문장을 고르고, 거절된 폴더를 가린다", () => {
    const denied: CommandError = {
      kind: "rejected",
      code: -32602,
      issue: "denied: installed copy",
    };
    expect([
      editFailureText(denied),
      editFailureText({ kind: "rejected", code: -32602, issue: "not_found: tap" }),
      editFailureText({ kind: "rejected", code: -32602, issue: "no_manifest: x" }),
      editFailureText({ kind: "rejected", code: -32602, issue: "invalid_input: x" }),
      editFailureText({ kind: "offline" }),
      editFailureText({ kind: "switching" }),
      editFailureText({ kind: "failed" }),
    ]).toEqual([
      "desktop.craft.members.fail.denied",
      "desktop.craft.members.fail.notFound",
      "desktop.craft.members.fail.noManifest",
      "desktop.craft.members.fail.invalid",
      "desktop.craft.members.fail.offline",
      "desktop.craft.members.fail.switching",
      "desktop.craft.members.fail.other",
    ]);
    expect([isDenied(denied), isDenied({ kind: "offline" })]).toEqual([true, false]);
  });
});
