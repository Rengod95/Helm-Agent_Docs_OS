import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import type { InvocableEntry } from "@fresnel/contracts/wire";
import { renderToString } from "react-dom/server";
import type { ConvoMarker, DriveInputRecord } from "../../src/state/engine/convo.ts";
import type { DriveFrameView } from "@fresnel/contracts/extensions";
import { DriveInputRow } from "../../src/views/convo/drive-input-row.tsx";
import { driveStackOf } from "../../src/views/convo/drive-stack-model.ts";
import { InvokedMark, OneShotChips } from "../../src/views/convo/one-shot.tsx";
import {
  ONE_SHOT_MAX,
  addPick,
  oneShotSendOf,
  overlayRefOf,
  type OneShotPick,
} from "../../src/views/convo/one-shot-model.ts";
import { profileChipViewOf, startDriveBlockOf } from "../../src/views/convo/profile-chip-model.ts";
import { markerTextOf, permissionModeNameOf } from "../../src/views/convo/turn-model.ts";
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
      title: "default",
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
        [t("desktop.drive.core"), true, t("desktop.drive.waiting"), "helm"],
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
