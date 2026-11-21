import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import type { InvocableEntry } from "@fresnel/contracts/wire";
import { renderToString } from "react-dom/server";
import type { ConvoMarker, DriveInputRecord } from "../../src/state/engine/convo.ts";
import type { DriveFrameView } from "@fresnel/contracts/extensions";
import { DriveInputRow } from "../../src/views/convo/drive-input-row.tsx";
import { driveInputLineOf } from "../../src/state/engine/convo.ts";
import {
  driveBandBeamOf,
  driveCardOf,
  driveStackOf,
  driveVersionOf,
  type DriveLeaseFacts,
  drivingByPartsOf,
} from "../../src/views/convo/drive-stack-model.ts";
import { ProfileGlyph } from "../../src/views/convo/profile-glyph.tsx";
import { composerBeamStateOf } from "../../src/views/effects/convo-beam.tsx";
import { InvokedMark, OneShotChips } from "../../src/views/convo/one-shot.tsx";
import {
  ONE_SHOT_MAX,
  addPick,
  oneShotSendOf,
  overlayRefOf,
  type OneShotPick,
} from "../../src/views/convo/one-shot-model.ts";
import {
  profileChipViewOf,
  profileLookOf,
  profileRowLookOf,
  profileTitleOf,
  startDriveBlockOf,
  startDriveOutcomeOf,
  startRejectReasonText,
  startOutcomeSettled,
  type ProfileChipView,
} from "../../src/views/convo/profile-chip-model.ts";
import { ProfileNotices, type ProfileChipState } from "../../src/views/convo/profile-chip.tsx";
import { markerTextOf, permissionModeNameOf } from "../../src/views/convo/turn-model.ts";
import { tokenCountText } from "../../src/views/model-usage.ts";
import { transcriptRowsOf } from "../../src/views/transcript-rows.ts";
import { itm, trn } from "../state/helpers.ts";

// lcM6a 순수 부분과 서버 렌더: 원샷 보내기(turn.start overlay), Drive 입력 줄 자리(lease.user_input),
// 프로필 바뀜 표지(profile.applied), 턴의 원샷 표지(turn.started.invoked), 칩 값, 스타트 Drive 막힘.

const AT = "2026-11-18T09:00:00.000Z";
const HASH = `sha256:${"a".repeat(64)}`;
const visible = (html: string): string =>
  html.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, "");

const ENTRIES: readonly InvocableEntry[] = [
  { plugin: "review", entry: "review", kind: "skill", title: "리뷰", reviewedHash: HASH },
  { plugin: "lint-kit", entry: "lint", kind: "command", title: "린트", reviewedHash: HASH },
  { plugin: "style", entry: "lint", kind: "skill", title: "스타일", reviewedHash: HASH },
  { plugin: "notes", entry: "note", kind: "skill", title: "메모", reviewedHash: HASH },
];

function pick(name: string, over: Partial<OneShotPick> = {}): OneShotPick {
  return {
    key: `p:${name}`,
    plugin: "p",
    name,
    title: name,
    until: "turn",
    draftId: null,
    whole: false,
    ...over,
  };
}

describe("원샷 보내기 → turn.start overlay", () => {
  const base = {
    picks: [],
    entries: ENTRIES,
    inSet: new Set(["notes"]),
    slashFree: true,
    hasAttachments: false,
  };

  test("친 /이름은 풀어서 나머지 글만 보내고 overlay에 항목을 싣는다", () => {
    expect(oneShotSendOf({ ...base, text: "/review 이 PR 봐 줘" })).toEqual({
      kind: "send",
      text: "이 PR 봐 줘",
      overlay: [{ plugin: "review", entry: "review" }],
      notice: null,
    });
  });

  test("이름이 여러 플러그인에 있으면 보내지 않고 한정 이름을 알린다", () => {
    expect(oneShotSendOf({ ...base, text: "/lint 고쳐" })).toEqual({
      kind: "problem",
      text: t("desktop.oneShot.ambiguous", {
        name: "lint",
        candidates: "/lint-kit:lint, /style:lint",
      }),
    });
  });

  test("원샷만 있고 글이 없으면 보낼 말을 적으라고 한다", () => {
    expect(oneShotSendOf({ ...base, text: "/review" })).toEqual({
      kind: "problem",
      text: t("desktop.oneShot.needsInput"),
    });
  });

  test("이미 프로필에 든 이름은 글을 그대로 보내고 알린다", () => {
    expect(oneShotSendOf({ ...base, text: "/note 메모해" })).toEqual({
      kind: "send",
      text: "/note 메모해",
      overlay: [],
      notice: t("desktop.oneShot.inProfile", { name: "note" }),
    });
  });

  test("고른 칩은 글과 함께 overlay가 된다. 드래프트는 draftId, 플러그인 전체는 entry 없이 싣는다", () => {
    const picks = [
      pick("review", { plugin: "review" }),
      pick("lint-kit", { plugin: "lint-kit", whole: true, draftId: "drf_1" }),
    ];
    expect(oneShotSendOf({ ...base, picks, text: "봐 줘", slashFree: false })).toEqual({
      kind: "send",
      text: "봐 줘",
      overlay: [
        { plugin: "review", entry: "review" },
        { plugin: "lint-kit", draftId: "drf_1" },
      ],
      notice: null,
    });
    expect(overlayRefOf(pick("x", { plugin: "x", whole: true }))).toEqual({ plugin: "x" });
  });

  test("한 턴에 넷까지만 고른다", () => {
    const four = ["a", "b", "c", "d"].map((name) => pick(name, { key: name }));
    expect(addPick(four, pick("e", { key: "e" }))).toEqual({ picks: four, full: true });
    expect(addPick(four.slice(0, 3), four[0] ?? pick("a")).picks).toHaveLength(3);
    expect(ONE_SHOT_MAX).toBe(4);
  });
});

const input = (seq: number, settled: boolean): DriveInputRecord => ({
  requestId: `req-${seq}`,
  scopeId: "helm",
  seq,
  at: AT,
  text: "검증도 같이",
  settled,
});

describe("Drive 입력 줄(lease.user_input)", () => {
  test("seq 자리(그 뒤 첫 턴 앞)에 서고, 같은 자리의 표지와 seq 순서로 선다", () => {
    const marker: ConvoMarker = {
      seq: 12,
      at: AT,
      change: { kind: "profile", from: "default", to: "review", missing: false, permission: null },
    };
    const rows = transcriptRowsOf({
      shapes: [
        { kind: "user", id: itm(1) },
        { kind: "user", id: itm(2) },
      ],
      live: [],
      showLive: true,
      anchors: [],
      turns: [
        { turnId: trn(1), startedSeq: 10, inputItemIds: [itm(1)], running: false },
        { turnId: trn(2), startedSeq: 20, inputItemIds: [itm(2)], running: false },
      ],
      markers: [marker],
      driveInputs: [input(11, true), input(15, false)],
      leads: [],
      running: false,
    });
    expect(rows.map((row) => row.key)).toEqual([
      itm(1),
      `foot:${trn(1)}`,
      "drive-input:req-11",
      "mark:12",
      "drive-input:req-15",
      itm(2),
      `foot:${trn(2)}`,
    ]);
  });

  test("말풍선 아래에 전달 대기 → 전달됨을 적는다", () => {
    const pending = renderToString(<DriveInputRow input={input(1, false)} />);
    expect(pending).toContain('data-drive-input="pending"');
    expect(visible(pending)).toContain(`검증도 같이${t("desktop.driveInput.pending")}`);
    const delivered = renderToString(<DriveInputRow input={input(1, true)} />);
    expect(visible(delivered)).toContain(t("desktop.driveInput.delivered"));
  });
});

const marker = (change: Extract<ConvoMarker["change"], { kind: "profile" }>): ConvoMarker => ({
  seq: 1,
  at: AT,
  change,
});
const names = (id: string): string => ({ default: "기본", review: "리뷰" })[id] ?? id;

describe("프로필 바뀜 표지(profile.applied)", () => {
  test("제목으로 적고 권한이 바뀌면 덧붙인다", () => {
    expect(
      markerTextOf(
        marker({
          kind: "profile",
          from: "default",
          to: "review",
          missing: false,
          permission: null,
        }),
        undefined,
        names,
      ),
    ).toBe(t("desktop.convo.marker.profile", { from: "기본", to: "리뷰" }));
    expect(
      markerTextOf(
        marker({
          kind: "profile",
          from: "review",
          to: "default",
          missing: true,
          permission: { from: "acceptEdits", to: "default" },
        }),
        undefined,
        names,
      ),
    ).toBe(
      t("desktop.convo.marker.profilePermission", {
        text: t("desktop.convo.marker.profileMissing", { from: "리뷰", to: "기본" }),
        from: permissionModeNameOf("acceptEdits"),
        to: permissionModeNameOf("default"),
      }),
    );
  });
});

describe("턴의 원샷 표지(turn.started.invoked)와 칩 줄", () => {
  test("턴 발 줄에 원샷 이름을 적고 드래프트면 그 표시를 붙인다", () => {
    const html = renderToString(
      <InvokedMark
        invoked={[
          { plugin: "review", entry: "review", kind: "skill", draft: false },
          { plugin: "lint-kit", entry: "lint-kit", kind: "plugin", draft: true },
        ]}
      />,
    );
    expect(visible(html)).toBe(
      `${t("desktop.oneShot.group")} /review · /lint-kit · ${t("desktop.oneShot.draft")}`,
    );
    expect(renderToString(<InvokedMark invoked={[]} />)).toBe("");
  });

  test("칩 줄: 고른 원샷은 지울 수 있고, Drive가 끝날 때까지 남은 원샷은 지울 단추가 없다", () => {
    const html = renderToString(
      <OneShotChips
        picks={[pick("review", { plugin: "review" })]}
        live={[{ plugin: "helm", draft: false }]}
        onRemove={() => {}}
      />,
    );
    expect(html).toContain(`aria-label="${t("desktop.oneShot.remove", { name: "review" })}"`);
    expect(html).toContain(`aria-label="${t("desktop.oneShot.liveAria", { name: "helm" })}"`);
    expect(visible(html)).toContain(t("desktop.oneShot.untilDrive"));
  });
});

describe("칩 값과 스타트 Drive 막힘", () => {
  test("적용된 값과 대화가 가리키는 값이 다르면 다음 단계부터 바뀔 것으로 본다", () => {
    expect(
      profileChipViewOf({
        applied: "default",
        assigned: "review",
        requested: null,
        read: { kind: "loading" },
      }),
    ).toEqual({
      currentId: "default",
      // 기본 프로필의 엔진 제목 default는 화면에서 "기본"이다(lcM6c)
      title: t("desktop.profileChip.defaultName"),
      pending: { id: "review", title: "review" },
      startDrive: null,
      escape: "switch",
    });
    expect(
      profileChipViewOf({
        applied: null,
        assigned: null,
        requested: null,
        read: { kind: "offline" },
      }).escape,
    ).toBe("reset");
  });

  test("이슈 가운데 그 플러그인의 첫 막힘을 고른다", () => {
    expect(
      startDriveBlockOf(
        [
          { code: "plugin_unknown", severity: "error", plugin: "other" },
          { code: "plugin_not_reviewed", severity: "error", plugin: "helm" },
        ],
        "helm",
      ),
    ).toBe("notReviewed");
    expect(startDriveBlockOf([{ code: "driver_cannot_drive", severity: "error" }], "helm")).toBe(
      "cannotDrive",
    );
    expect(startDriveBlockOf([], "helm")).toBeNull();
  });
});

/** 프로필 줄의 스타트 Drive 줄 이름들(서버 렌더 글에서) */
function slotsOf(html: string): string[] {
  return [...html.matchAll(/data-slot="(start-drive-[a-z]+)"/g)].map((match) => match[1] ?? "");
}

describe("전환의 스타트 Drive 결과(thread.setProfile.startDrive, AGE-64, lcM6e)", () => {
  test("기다림·거절만 알리고, 시작했거나 이미 쥐었거나 없거나 옛 호스트면 알리지 않는다", () => {
    expect(
      (["requested", "deferred", "leading", "none", "rejected", null] as const).map((result) =>
        startDriveOutcomeOf(result, null, "helm"),
      ),
    ).toEqual([
      null,
      { kind: "deferred", plugin: "helm", reason: null },
      null,
      null,
      { kind: "rejected", plugin: "helm", reason: null },
      null,
    ]);
    // 새 프로필에 스타트 Drive가 없으면 결과가 무엇이든 알릴 것이 없다
    expect(startDriveOutcomeOf("deferred", null, null)).toBeNull();
    // 까닭은 거절에만 붙는다(lcM6h)
    expect([
      startDriveOutcomeOf("rejected", "drive_error", "helm"),
      startDriveOutcomeOf("deferred", "drive_error", "helm"),
    ]).toEqual([
      { kind: "rejected", plugin: "helm", reason: "drive_error" },
      { kind: "deferred", plugin: "helm", reason: null },
    ]);
  });

  test("기다림은 그 플러그인이 스택에 서거나, 턴이 끝났는데 플러그인 Drive가 없으면 내린다. 거절은 남는다", () => {
    const deferred = { kind: "deferred", plugin: "helm", reason: null } as const;
    expect([
      startOutcomeSettled(deferred, { plugins: [], running: true }),
      startOutcomeSettled(deferred, { plugins: ["authoring"], running: false }),
      startOutcomeSettled(deferred, { plugins: ["authoring", "helm"], running: true }),
      startOutcomeSettled(deferred, { plugins: [], running: false }),
      startOutcomeSettled(
        { kind: "rejected", plugin: "helm", reason: null },
        { plugins: [], running: false },
      ),
      startOutcomeSettled(null, { plugins: [], running: false }),
    ]).toEqual([false, false, true, true, false, false]);
  });

  const view: ProfileChipView = {
    currentId: "review",
    title: "리뷰",
    pending: null,
    startDrive: "helm",
    escape: "switch",
  };
  const stateOf = (over: Partial<ProfileChipState>): ProfileChipState => ({
    view,
    read: { kind: "loading" },
    changed: null,
    permission: null,
    startDrive: null,
    startOutcome: null,
    recentId: null,
    offline: false,
    choose: () => {},
    onOpen: () => {},
    resetPreview: () => {},
    resetOffer: null,
    closeReset: () => {},
    ...over,
  });

  test("기다림은 경고색 없는 조용한 줄 하나, 거절은 경고 줄이다", () => {
    const deferred = renderToString(
      <ProfileNotices
        state={stateOf({ startOutcome: { kind: "deferred", plugin: "helm", reason: null } })}
      />,
    );
    expect(slotsOf(deferred)).toEqual(["start-drive-deferred"]);
    expect(deferred).toContain(t("desktop.startDrive.deferred", { plugin: "helm" }));
    expect(deferred).not.toContain("data-problem-line");
    const rejected = renderToString(
      <ProfileNotices
        state={stateOf({ startOutcome: { kind: "rejected", plugin: "helm", reason: null } })}
      />,
    );
    expect(slotsOf(rejected)).toEqual(["start-drive-rejected"]);
    expect(rejected).toContain('data-problem-line="warning"');
    expect(rejected).toContain(t("desktop.startDrive.reason.refused"));
  });

  test("거절의 까닭은 엔진의 startDriveReason 값마다 한 문장이고, 없으면 일반 문장이다(lcM6h)", () => {
    expect(
      (
        [
          "unknown_thread",
          "child_thread",
          "unknown_scope",
          "not_drive",
          "drive_error",
          null,
        ] as const
      ).map((reason) => t(startRejectReasonText(reason))),
    ).toEqual([
      t("desktop.startDrive.reason.unknownThread"),
      t("desktop.startDrive.reason.childThread"),
      t("desktop.startDrive.reason.missing"),
      t("desktop.startDrive.reason.cannotDrive"),
      t("desktop.startDrive.reason.driveError"),
      t("desktop.startDrive.reason.refused"),
    ]);
    const html = renderToString(
      <ProfileNotices
        state={stateOf({
          startOutcome: { kind: "rejected", plugin: "helm", reason: "drive_error" },
        })}
      />,
    );
    expect(html).toContain(t("desktop.startDrive.reason.driveError"));
    expect(html).not.toContain(t("desktop.startDrive.reason.refused"));
  });

  test("거절했고 까닭(막힘)을 알면 막힘 줄 하나로 말한다", () => {
    const html = renderToString(
      <ProfileNotices
        state={stateOf({
          startOutcome: { kind: "rejected", plugin: "helm", reason: null },
          startDrive: { plugin: "helm", block: "notReviewed" },
        })}
      />,
    );
    expect(slotsOf(html)).toEqual(["start-drive-notice"]);
    expect(html).toContain(t("desktop.startDrive.reason.notReviewed"));
  });

  test("아무 결과도 없으면 줄이 없다", () => {
    expect(slotsOf(renderToString(<ProfileNotices state={stateOf({})} />))).toEqual([]);
  });
});

const driveFrame = (
  depth: number,
  plugin: string | null,
  state: DriveFrameView["state"],
  over: Partial<DriveFrameView> = {},
): DriveFrameView => ({
  depth,
  plugin,
  versionId: null,
  leaseId: plugin === null ? null : `lease-${plugin}`,
  state,
  used: { turns: 0, spawns: 0, tokens: 0 },
  limits: {},
  ...over,
});

describe("Drive 스택 그림 값(drive.frames → 띠·판)", () => {
  test("깊이 순서로 다시 세우고, 핸드오프한 칸은 넘겨받은 바로 위 칸의 이름을 가진다", () => {
    const view = driveStackOf([
      driveFrame(2, "verifier", "driving"),
      driveFrame(0, null, "waiting"),
      driveFrame(1, "helm", "waiting"),
    ]);
    expect(view.steps.map((step) => [step.name, step.core, step.stateText, step.handedTo])).toEqual(
      [
        // 기본 루프는 핸드오프하지 않는다(lcM6c): 위 Drive를 기다린다는 말만 있고 넘겨준 칸은 없다
        [t("desktop.drive.core"), true, t("desktop.drive.coreWaiting"), null],
        ["helm", false, t("desktop.drive.waiting"), "verifier"],
        ["verifier", false, t("desktop.drive.driving"), null],
      ],
    );
    expect(view.alone).toBe(false);
    expect(view.handoff).toBe(true);
    expect(view.path).toBe(`${t("desktop.drive.core")} › helm › verifier`);
  });

  test("기본 루프만 돌면 그 칸 하나가 Drive 없음이다", () => {
    const view = driveStackOf([driveFrame(0, null, "driving")]);
    expect(view.steps.map((step) => [step.stateText, step.handedTo, step.meters])).toEqual([
      [t("desktop.drive.alone"), null, []],
    ]);
    expect(view.alone).toBe(true);
    expect(view.handoff).toBe(false);
  });

  test("한도가 있는 칸만 막대가 되고, 채움은 0..1, 90%부터 경고다. 한도 0은 가득 찬 경고다", () => {
    const view = driveStackOf([
      driveFrame(0, null, "waiting"),
      driveFrame(1, "helm", "asking", {
        used: { turns: 11, spawns: 0, tokens: 50_000 },
        limits: { turns: 12, tokens: 200_000, spawns: 0 },
      }),
    ]);
    const top = view.steps.at(-1);
    expect(top?.stateText).toBe(t("desktop.drive.asking"));
    expect(
      top?.meters.map((meter) => [meter.kind, Math.round(meter.ratio * 100), meter.warn]),
    ).toEqual([
      ["turns", 92, true],
      ["tokens", 25, false],
      ["spawns", 100, true],
    ]);
    // 쓴 양이 한도를 넘어도 막대는 가득 찬 데서 멈춘다
    const over = driveStackOf([
      driveFrame(1, "helm", "driving", {
        used: { turns: 20, spawns: 0, tokens: 0 },
        limits: { turns: 12 },
      }),
    ]);
    expect(over.steps[0]?.meters.map((meter) => meter.ratio)).toEqual([1]);
  });
});

// lcM6c: 띠는 맨 위 칸 하나와 아래 수(+N), 띠의 빛 규칙, 맨 위 판 카드 값, 프로필 아이콘 변주와 기본 이름

const lease = (over: Partial<DriveLeaseFacts> = {}): DriveLeaseFacts => ({
  leaseId: "lease-verifier",
  parent: null,
  requestId: null,
  inputLine: null,
  branchesRunning: 0,
  ...over,
});

const HANDOFF = [
  driveFrame(0, null, "waiting"),
  driveFrame(1, "helm", "waiting", {
    used: { turns: 4, spawns: 1, tokens: 30_000 },
    limits: { turns: 12 },
  }),
  driveFrame(2, "verifier", "driving", {
    versionId: `sha256:${"ab12cd34".repeat(8)}`,
    used: { turns: 7, spawns: 0, tokens: 9_000 },
    limits: { turns: 8, tokens: 200_000 },
  }),
];

describe("Drive 띠와 카드 값(lcM6c)", () => {
  test("스택 길: 아래 → 위 칸 이름을 잇는다(띠의 aria와 판의 목록 이름)", () => {
    expect(driveStackOf(HANDOFF).path).toBe(`${t("desktop.drive.core")} › helm › verifier`);
    expect(driveStackOf([driveFrame(0, null, "driving")]).path).toBe(t("desktop.drive.core"));
  });

  test("엔진이 늘 driving으로 보내는 기본 루프 칸은 위에 플러그인 칸이 있으면 위 Drive를 기다림으로 읽고 핸드오프로 적지 않는다", () => {
    const view = driveStackOf([
      driveFrame(0, null, "driving"),
      driveFrame(1, "authoring", "driving"),
    ]);
    expect(
      view.steps.map((step) => [step.name, step.state, step.stateText, step.handedTo]),
    ).toEqual([
      [t("desktop.drive.core"), "waiting", t("desktop.drive.coreWaiting"), null],
      ["authoring", "driving", t("desktop.drive.driving"), null],
    ]);
    // 혼자일 때는 그대로 Drive 없음이다
    expect(driveStackOf([driveFrame(0, null, "driving")]).steps[0]?.state).toBe("driving");
  });

  test("카드의 한도 줄은 이름 칸이 따로 있어 이름 없는 양을 쓴다", () => {
    const view = driveStackOf([
      driveFrame(0, null, "waiting"),
      driveFrame(1, "helm", "driving", {
        used: { turns: 3, spawns: 1, tokens: 9000 },
        limits: { turns: 8, tokens: 200_000, spawns: 4 },
      }),
    ]);
    expect(view.steps.at(-1)?.meters.map((meter) => meter.amount)).toEqual([
      "3/8",
      `${tokenCountText(9000)}/${tokenCountText(200_000)}`,
      "1/4",
    ]);
  });

  test("판 표시: sha256는 앞 7자, draft는 드래프트, 모르는 모양과 null은 없음", () => {
    expect(driveVersionOf(`sha256:${"ABCDEF12".repeat(8)}`)).toEqual({
      kind: "approved",
      short: "abcdef1",
    });
    expect(driveVersionOf("draft:drf_1:0a1b2c3d")).toEqual({ kind: "draft" });
    expect(driveVersionOf("v1.2.0")).toBeNull();
    expect(driveVersionOf(null)).toBeNull();
  });

  test("띠의 빛: 띠가 있으면 입력창 빛을 맡고, Drive 중에 턴이 돌면 run, 승인을 기다리면 wait, 아니면 off", () => {
    const view = driveStackOf(HANDOFF);
    expect(driveBandBeamOf({ view, running: true, approvals: 0 })).toEqual({
      band: true,
      state: "run",
    });
    expect(driveBandBeamOf({ view, running: false, approvals: 0 })).toEqual({
      band: true,
      state: "off",
    });
    expect(driveBandBeamOf({ view, running: true, approvals: 1 })).toEqual({
      band: true,
      state: "wait",
    });
    const asking = driveStackOf([driveFrame(0, null, "waiting"), driveFrame(1, "helm", "asking")]);
    expect(driveBandBeamOf({ view: asking, running: true, approvals: 0 })).toEqual({
      band: true,
      state: "off",
    });
    const alone = driveStackOf([driveFrame(0, null, "driving")]);
    expect(driveBandBeamOf({ view: alone, running: true, approvals: 0 })).toEqual({
      band: false,
      state: "off",
    });
    expect(driveBandBeamOf({ view: null, running: true, approvals: 2 })).toEqual({
      band: false,
      state: "off",
    });
  });

  test("입력창 빛: Drive 띠가 맡으면 꺼지고, 아니면 전과 같다", () => {
    expect(composerBeamStateOf({ running: true, awaitingApproval: false, driveBand: true })).toBe(
      "off",
    );
    expect(composerBeamStateOf({ running: true, awaitingApproval: true, driveBand: true })).toBe(
      "off",
    );
    expect(composerBeamStateOf({ running: true, awaitingApproval: false, driveBand: false })).toBe(
      "run",
    );
    expect(composerBeamStateOf({ running: false, awaitingApproval: true, driveBand: false })).toBe(
      "wait",
    );
  });

  test("카드: 핸드오프로 쥔 칸은 넘겨받은 입력, 갈래, 끝나면 갈 칸을 가지고, 한도는 남은 양 글 없이 양만 가진다", () => {
    const view = driveStackOf(HANDOFF);
    const card = driveCardOf(
      view,
      [
        lease({
          parent: "lease-helm",
          requestId: "req-9",
          inputLine: "결과를 검증해 줘",
          branchesRunning: 2,
        }),
      ],
      true,
    );
    expect(
      card === null
        ? null
        : {
            name: card.step.name,
            version: card.step.version,
            input: card.input,
            activity: card.activity,
            branches: card.branches,
            next: card.next,
            meters: card.step.meters.map((m) => [m.text, m.amount, m.warn]),
          },
    ).toEqual({
      name: "verifier",
      version: { kind: "approved", short: "ab12cd3" },
      input: "결과를 검증해 줘",
      activity: "turn",
      branches: 2,
      next: "helm",
      meters: [
        [t("desktop.convo.lead.turns", { used: 7, max: 8 }), "7/8", false],
        [
          t("desktop.convo.lead.tokens", {
            used: tokenCountText(9_000),
            max: tokenCountText(200_000),
          }),
          `${tokenCountText(9_000)}/${tokenCountText(200_000)}`,
          false,
        ],
      ],
    });
  });

  test("카드: 입력 줄은 명령으로 쥔 칸에만 있고, 스타트 Drive나 임대 기록을 못 본 칸은 없다", () => {
    const view = driveStackOf([
      driveFrame(0, null, "waiting"),
      driveFrame(1, "verifier", "driving"),
    ]);
    expect(driveCardOf(view, [lease({ requestId: "req-1", inputLine: "x" })], false)?.input).toBe(
      "x",
    );
    expect(driveCardOf(view, [lease({ inputLine: "y" })], false)?.input).toBeNull();
    const unknown = driveCardOf(view, [], false);
    expect(unknown === null ? null : [unknown.input, unknown.activity, unknown.next]).toEqual([
      null,
      "holding",
      t("desktop.drive.core"),
    ]);
  });

  test("카드: 답을 기다리는 칸은 asking이고, 플러그인 프레임이 없으면 카드가 없다", () => {
    const view = driveStackOf([driveFrame(0, null, "waiting"), driveFrame(1, "helm", "asking")]);
    expect(driveCardOf(view, [], true)?.activity).toBe("asking");
    expect(driveCardOf(driveStackOf([driveFrame(0, null, "driving")]), [], true)).toBeNull();
  });

  test("한도: 다 쓰면 경고이고 양만 보인다(남은 양 글이 없다)", () => {
    const view = driveStackOf([
      driveFrame(1, "helm", "driving", {
        used: { turns: 8, spawns: 3, tokens: 0 },
        limits: { turns: 8, spawns: 4 },
      }),
    ]);
    expect(view.steps[0]?.meters.map((m) => [m.amount, m.warn])).toEqual([
      ["8/8", true],
      ["3/4", false],
    ]);
  });

  test("넘겨받은 입력 한 줄: 글, 객체의 task 같은 키, 그 밖은 null. 줄바꿈은 빈칸, 160자에서 자른다", () => {
    expect(driveInputLineOf("  검증\n해 줘 ")).toBe("검증 해 줘");
    expect(driveInputLineOf({ files: ["a"], task: "결과 검증" })).toBe("결과 검증");
    expect(driveInputLineOf({ goal: "", summary: "요약" })).toBe("요약");
    expect(driveInputLineOf({ files: ["a"] })).toBeNull();
    expect(driveInputLineOf(42)).toBeNull();
    expect(driveInputLineOf(undefined)).toBeNull();
    const long = driveInputLineOf("가".repeat(200));
    expect([long?.length, long?.endsWith("…")]).toEqual([160, true]);
  });
});

describe("Driving by 구절(lcM6g)", () => {
  test("번역 글을 이름 자리에서 나눈다: 앞 글, 이름, 뒤 글(빈칸은 그리는 쪽이 둔다)", () => {
    expect([drivingByPartsOf("authoring"), drivingByPartsOf("a very long plugin name")]).toEqual([
      { before: "Driving by", name: "authoring", after: "" },
      { before: "Driving by", name: "a very long plugin name", after: "" },
    ]);
    expect(t("desktop.drive.drivingBy", { name: "authoring" })).toBe("Driving by authoring");
  });
});

describe("프로필 아이콘 변주와 기본 이름(lcM6c)", () => {
  const ready = { kind: "ready", profiles: [] } as const;
  const viewOf = (over: { applied?: string; requested?: string | null } = {}) =>
    profileChipViewOf({
      applied: over.applied ?? "review",
      assigned: over.applied ?? "review",
      requested: over.requested ?? null,
      read: ready,
    });

  test("앞선 상태가 이긴다: 바꾸는 중, 시작할 수 없음, 방금 바뀜, 읽기 실패, 스타트 Drive, 기본, 보통", () => {
    const base = { changed: false, failed: false, blocked: false };
    expect(profileLookOf({ ...base, view: viewOf({ requested: "fast" }), blocked: true })).toBe(
      "pending",
    );
    expect(profileLookOf({ ...base, view: viewOf(), blocked: true, changed: true })).toBe(
      "blocked",
    );
    expect(profileLookOf({ ...base, view: viewOf(), changed: true, failed: true })).toBe("changed");
    expect(profileLookOf({ ...base, view: viewOf(), failed: true })).toBe("unsure");
    expect(profileLookOf({ ...base, view: { ...viewOf(), startDrive: "helm" } })).toBe("start");
    expect(profileLookOf({ ...base, view: viewOf({ applied: "default" }) })).toBe("default");
    expect(profileLookOf({ ...base, view: viewOf() })).toBe("ready");
    expect(profileRowLookOf({ id: "default", startDrive: null })).toBe("default");
    expect(profileRowLookOf({ id: "default", startDrive: "helm" })).toBe("start");
    expect(profileRowLookOf({ id: "review", startDrive: null })).toBe("ready");
  });

  test("엔진이 준 기본 프로필 제목 default는 화면에서 기본이고, 사용자가 붙인 이름은 그대로다", () => {
    expect(profileTitleOf("default", "default")).toBe(t("desktop.profileChip.defaultName"));
    expect(profileTitleOf("default", " Default ")).toBe(t("desktop.profileChip.defaultName"));
    expect(profileTitleOf("default", "내 기본")).toBe("내 기본");
    expect(profileTitleOf("review", "default")).toBe("default");
    expect(viewOf({ applied: "default" }).title).toBe(t("desktop.profileChip.defaultName"));
  });

  test("프로필 아이콘은 변주마다 다른 모양이고 16·20 크기를 style로 준다", () => {
    const looks = ["ready", "start", "pending", "changed", "default", "unsure", "blocked"] as const;
    const html = looks.map((look) => renderToString(<ProfileGlyph look={look} size={16} />));
    expect(new Set(html.map((one) => one.replace(/data-profile-glyph="[a-z]+"/, ""))).size).toBe(7);
    expect(
      renderToString(<ProfileGlyph look="ready" size={20} />).includes("width:20px;height:20px"),
    ).toBe(true);
  });
});
