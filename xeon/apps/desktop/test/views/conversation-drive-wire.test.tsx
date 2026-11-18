import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { Menu } from "@caustic/react";
import { t } from "@fresnel/client/i18n";
import { ok } from "@fresnel/contracts";
import type { DriveFrameView } from "@fresnel/contracts/extensions";
import type {
  EventWire,
  InvocableEntry,
  Profile,
  ProfilePreviewResult,
} from "@fresnel/contracts/wire";
import { parseHTML } from "linkedom";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { decodeDurable } from "../../src/state/engine/decode.ts";
import { createUiStore } from "../../src/state/ui/store.ts";
import type { Commands } from "../../src/views/commands.ts";
import { useDriveFrames } from "../../src/views/convo/drive-frames.ts";
import { DriveStackBand, DriveStackList } from "../../src/views/convo/drive-stack.tsx";
import { driveStackOf } from "../../src/views/convo/drive-stack-model.ts";
import { OneShotRow, useOneShotSource } from "../../src/views/convo/one-shot.tsx";
import { oneShotRowsOf } from "../../src/views/convo/one-shot-model.ts";
import {
  ProfileChip,
  ProfileNotices,
  ProfileRows,
  resetLinesOf,
  useProfileChip,
  type ProfileChipState,
} from "../../src/views/convo/profile-chip.tsx";
import { permissionModeNameOf } from "../../src/views/convo/turn-model.ts";
import { Providers } from "../../src/views/providers.tsx";
import { SUB, evt, openedHarness, summary, thr } from "../state/helpers.ts";
import { fakeCommands } from "./fake-commands.ts";

// lcM6a: 대화 화면 부품이 부르는 wire 메서드마다 "가짜 응답(상태) → 화면 글"을 본다. linkedom DOM 위에 실제 훅을 올린다.
// profile.list · profile.preview · thread.setProfile · profile.defaultFor · profile.default.reset → 프로필 칩·경고 줄·메뉴
// drive.frames · drive.framesChanged → Drive 스택 띠·목록
// plugin.invocables · plugin.list · plugin.draft.list → 원샷 목록 행

const GLOBAL_KEYS = [
  "window",
  "document",
  "navigator",
  "Node",
  "HTMLElement",
  "IS_REACT_ACT_ENVIRONMENT",
] as const;
const saved = new Map<string, PropertyDescriptor | undefined>();

beforeAll(() => {
  const { window, document } = parseHTML("<!doctype html><html><body></body></html>");
  for (const key of GLOBAL_KEYS) saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  const values: Record<(typeof GLOBAL_KEYS)[number], unknown> = {
    window,
    document,
    navigator: window.navigator,
    Node: window.Node,
    HTMLElement: window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const key of GLOBAL_KEYS) {
    Object.defineProperty(globalThis, key, {
      value: values[key],
      configurable: true,
      writable: true,
    });
  }
});

afterAll(() => {
  for (const key of GLOBAL_KEYS) {
    const before = saved.get(key);
    if (before === undefined) Reflect.deleteProperty(globalThis, key);
    else Object.defineProperty(globalThis, key, before);
  }
});

const T = thr(1);
const HASH = `sha256:${"a".repeat(64)}`;
const roots: Root[] = [];

afterEach(async () => {
  const mounted = roots.splice(0);
  await act(async () => {
    for (const root of mounted) root.unmount();
  });
});

function profile(id: string, title: string, over: Partial<Profile> = {}): Profile {
  return {
    id,
    title,
    builtin: id === "default",
    plugins: [],
    settings: [],
    startDrive: null,
    updatedAt: "2026-11-18T09:00:00Z",
    rev: 1,
    ...over,
  };
}

const PROFILES: readonly Profile[] = [
  profile("default", "기본"),
  profile("review", "리뷰", { startDrive: "helm", plugins: [{ name: "helm" }] }),
  profile("yolo", "빠르게", { settings: [{ key: "l1.tools.permissionMode", value: "bypass" }] }),
];

function preview(issues: ProfilePreviewResult["issues"]): ProfilePreviewResult {
  return {
    resolved: [],
    issues,
    cost: {
      total: { always: null, drive: null, onDemand: null, toolCount: null, basis: "unknown" },
      byPlugin: [],
    },
    missingRequired: [],
    threadsUsing: 1,
    dropsDrive: null,
  };
}

function appliedWire(seq: number, profileId: string): EventWire {
  return {
    id: evt(seq),
    kind: "profile.applied",
    version: 1,
    durable: true,
    seq,
    parentId: null,
    threadId: T,
    turnId: null,
    stepId: null,
    recordedAt: "2026-11-18T09:00:00.000Z",
    causationId: null,
    correlationId: null,
    payload: {
      reason: "open",
      profileId,
      profileRev: 1,
      commonRev: 1,
      added: [],
      removed: [],
      overlay: [],
    },
    redactions: [],
  };
}

/** 열린 대화 하나(프로필 review, 폴더 /w/app)와 단계 경계에서 쓰인 review */
function engine(): ReturnType<typeof openedHarness> {
  const h = openedHarness(5);
  h.store.ingest({
    type: "threads",
    threads: [summary(T, { profileId: "review", workspace: "/w/app" })],
  });
  h.store.ingest({
    type: "batch",
    sub: SUB,
    from: 5,
    to: 6,
    caughtUp: true,
    facts: [decodeDurable(appliedWire(6, "review"))],
  });
  h.store.flush();
  return h;
}

function withWorkbench(over: Partial<Commands["workbench"]>): Commands {
  const base = fakeCommands();
  return fakeCommands({ workbench: { ...base.workbench, ...over } });
}

/** 마운트하고 이어진 읽기(약속 몇 단)가 끝날 때까지 기다린다 */
async function mount(node: ReactNode, commands: Commands): Promise<HTMLElement> {
  const h = engine();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(
      <Providers engine={h.store.read} ui={createUiStore().read} commands={commands}>
        {node}
      </Providers>,
    );
  });
  await settle();
  return container;
}

/** 가짜 명령은 모두 이미 풀린 약속이라, 한 번의 매크로 작업이 이어진 마이크로 작업(읽기 몇 단)을 다 비운다 */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}

describe("프로필 칩: profile.list · profile.preview · thread.setProfile · profile.defaultFor", () => {
  let captured: ProfileChipState | null = null;
  const errors: string[] = [];
  function ChipProbe(): ReactNode {
    const state = useProfileChip(T, (text) => {
      errors.push(text);
    });
    captured = state;
    return (
      <div>
        <ProfileChip state={state} disabled={false} />
        <ProfileNotices state={state} />
        <Menu inline open>
          <ProfileRows state={state} />
        </Menu>
      </div>
    );
  }

  test("목록의 제목으로 지금 프로필을 적고, 스타트 Drive가 멈춰 있으면 경고 줄을 보인다", async () => {
    const asked: unknown[] = [];
    const container = await mount(
      <ChipProbe />,
      withWorkbench({
        profiles: () => Promise.resolve(ok(PROFILES)),
        previewProfile: (id, threadId) => {
          asked.push({ id, threadId });
          return Promise.resolve(
            ok(preview([{ code: "driver_unavailable", severity: "warning", plugin: "helm" }])),
          );
        },
      }),
    );
    const chip = container.querySelector('[data-composer-chip="profile"]');
    expect(chip?.textContent).toBe("리뷰");
    expect(chip?.querySelector('[data-slot="start-drive-mark"]')).not.toBeNull();
    expect(asked).toEqual([{ id: "review", threadId: T }]);
    expect(container.querySelector('[data-slot="start-drive-notice"]')?.textContent).toBe(
      `${t("desktop.startDrive.unavailable", { plugin: "helm" })}. ${t("desktop.startDrive.reason.stopped")}. ${t("desktop.startDrive.fallback")}`,
    );
  });

  test("다른 프로필을 고르면 다음 단계부터라고 적고, 권한이 넓어지면 경고 줄을 보인다", async () => {
    const sent: unknown[] = [];
    const container = await mount(
      <ChipProbe />,
      withWorkbench({
        profiles: () => Promise.resolve(ok(PROFILES)),
        applyProfile: (id, threadId) => {
          sent.push({ id, threadId });
          return Promise.resolve(
            ok({
              position: { storeId: "sto_00000000000000000000000001", seq: 9 },
              preview: { permission: { from: "default", to: "bypass" } },
            }),
          );
        },
      }),
    );
    await act(async () => {
      captured?.choose("yolo");
    });
    await settle();
    expect(sent).toEqual([{ id: "yolo", threadId: T }]);
    const chip = container.querySelector('[data-composer-chip="profile"]');
    expect(chip?.getAttribute("data-state")).toBe("pending");
    expect(chip?.textContent).toBe(t("desktop.profileChip.pending", { to: "빠르게" }));
    expect(container.querySelector('[data-slot="profile-permission-notice"]')?.textContent).toBe(
      t("desktop.profileChip.permission", {
        from: permissionModeNameOf("default"),
        to: permissionModeNameOf("bypass"),
      }),
    );
  });

  test("거절되면 바꾸지 않고 오류 글을 넘긴다", async () => {
    errors.length = 0;
    const container = await mount(
      <ChipProbe />,
      withWorkbench({
        profiles: () => Promise.resolve(ok(PROFILES)),
        applyProfile: () => Promise.resolve({ ok: false, error: { kind: "failed" } }),
      }),
    );
    await act(async () => {
      captured?.choose("yolo");
    });
    await settle();
    expect(errors).toEqual([t("desktop.inspect.profile.error.failed")]);
    expect(container.querySelector('[data-composer-chip="profile"]')?.textContent).toBe("리뷰");
  });

  test("메뉴를 열면 이 폴더의 최근 프로필을 묻고 그 줄에 표시한다. 숨긴 프로필은 빠진다", async () => {
    const asked: unknown[] = [];
    const container = await mount(
      <ChipProbe />,
      withWorkbench({
        profiles: () =>
          Promise.resolve(ok([...PROFILES, profile("secret", "숨김", { hidden: true })])),
        defaultProfileFor: (workspace) => {
          asked.push(workspace);
          return Promise.resolve(ok("yolo"));
        },
      }),
    );
    await act(async () => {
      captured?.onOpen();
    });
    await settle();
    expect(asked).toEqual(["/w/app"]);
    const rows = [...container.querySelectorAll("[data-profile-row]")].map((row) => ({
      id: row.getAttribute("data-profile-row"),
      checked: row.getAttribute("aria-checked"),
      text: row.textContent,
    }));
    expect(rows).toEqual([
      { id: "default", checked: "false", text: "기본" },
      {
        id: "review",
        checked: "true",
        text: `리뷰${t("desktop.profileChip.startDrive", { plugin: "helm" })}`,
      },
      {
        id: "yolo",
        checked: "false",
        text: `빠르게${permissionModeNameOf("bypass")} · ${t("desktop.profileChip.recent")}`,
      },
    ]);
  });

  test("profile.default.reset 미리 보기를 받으면 확인 상자의 줄을 그 값으로 만든다", async () => {
    const offer = {
      profile: PROFILES[0] ?? profile("default", "기본"),
      changed: { plugins: true, settings: false },
      threadsUsing: 3,
    };
    const asked: boolean[] = [];
    await mount(
      <ChipProbe />,
      withWorkbench({
        resetDefaultProfile: (previewOnly) => {
          asked.push(previewOnly);
          return Promise.resolve(ok(offer));
        },
      }),
    );
    await act(async () => {
      captured?.resetPreview();
    });
    await settle();
    expect(asked).toEqual([true]);
    expect(captured?.resetOffer).toEqual(offer);
    expect(resetLinesOf(offer)).toEqual([
      t("desktop.profileChip.resetBody", { threads: 3 }),
      t("desktop.profileChip.resetPlugins"),
    ]);
    expect(resetLinesOf({ ...offer, changed: { plugins: false, settings: false } })).toEqual([
      t("desktop.profileChip.resetNone"),
    ]);
  });
});

function frame(
  depth: number,
  plugin: string | null,
  state: DriveFrameView["state"],
  over: Partial<DriveFrameView> = {},
): DriveFrameView {
  return {
    depth,
    plugin,
    versionId: null,
    leaseId: plugin === null ? null : `lease-${plugin}`,
    state,
    used: { turns: 0, spawns: 0, tokens: 0 },
    limits: {},
    ...over,
  };
}

function DriveProbe(): ReactNode {
  const read = useDriveFrames(T);
  if (read.kind !== "ready") return <p data-read={read.kind} />;
  const view = driveStackOf(read.frames);
  return (
    <>
      <DriveStackBand view={view} />
      <DriveStackList view={view} />
    </>
  );
}

describe("Drive 스택: drive.frames · drive.framesChanged", () => {
  test("핸드오프 중이면 띠에 기본 › helm › verifier와 핸드오프 중을 적고, 알림이 오면 다시 읽는다", async () => {
    let frames: readonly DriveFrameView[] = [
      frame(0, null, "waiting"),
      frame(1, "helm", "waiting"),
      frame(2, "verifier", "driving", {
        used: { turns: 7, spawns: 0, tokens: 0 },
        limits: { turns: 8 },
      }),
    ];
    const notify = { fire: (): void => {} };
    const container = await mount(
      <DriveProbe />,
      withWorkbench({
        driveFrames: () => Promise.resolve(ok(frames)),
        onDriveFramesChanged: (_thread, listener) => {
          notify.fire = listener;
          return () => {};
        },
      }),
    );
    const band = container.querySelector('[data-slot="drive-stack-band"]');
    expect(band?.getAttribute("aria-label")).toBe(
      t("desktop.drive.aria", { path: `${t("desktop.drive.core")} › helm › verifier` }),
    );
    expect(band?.textContent).toContain(t("desktop.drive.handoff"));
    expect(band?.textContent).toContain(t("desktop.convo.lead.turns", { used: 7, max: 8 }));
    const steps = [...container.querySelectorAll('[data-slot="drive-stack-list"] li')].map((li) => [
      li.getAttribute("data-drive-step"),
      li.className.includes("ps-"),
    ]);
    // 띠와 같은 순서(기본 › helm › verifier), 넘겨받은 칸일수록 들여 쓴다
    expect(steps).toEqual([
      ["waiting", false],
      ["waiting", true],
      ["driving", true],
    ]);

    frames = [frame(0, null, "waiting"), frame(1, "helm", "driving")];
    await act(async () => {
      notify.fire();
    });
    await settle();
    expect(container.querySelector('[data-slot="drive-stack-band"]')?.textContent).toContain(
      t("desktop.drive.driving"),
    );
  });

  test("기본 루프만 돌면 띠가 없고 목록은 기본 루프만 돈다고 적는다", async () => {
    const container = await mount(
      <DriveProbe />,
      withWorkbench({ driveFrames: () => Promise.resolve(ok([frame(0, null, "driving")])) }),
    );
    expect(container.querySelector('[data-slot="drive-stack-band"]')).toBeNull();
    expect(container.querySelector('[data-slot="drive-stack-list"]')?.textContent).toContain(
      t("desktop.drive.alone"),
    );
  });

  test("읽지 못하면 오류 상태다", async () => {
    const container = await mount(<DriveProbe />, withWorkbench({}));
    expect(container.querySelector("[data-read]")?.getAttribute("data-read")).toBe("error");
  });
});

function OneShotProbe(): ReactNode {
  const source = useOneShotSource(T, "review", true);
  if (source.kind !== "ready") return <p data-read={source.kind} />;
  const rows = oneShotRowsOf({ ...source, typed: "" });
  return (
    <ul>
      {rows.map((pick) => (
        <OneShotRow
          key={pick.key}
          id={pick.key}
          pick={pick}
          selected={false}
          onPick={() => {}}
          onHover={() => {}}
        />
      ))}
    </ul>
  );
}

describe("원샷 목록: plugin.invocables · plugin.list · plugin.draft.list", () => {
  const ENTRIES: readonly InvocableEntry[] = [
    { plugin: "helm", entry: "start", kind: "drive", title: "시작", reviewedHash: HASH },
    { plugin: "helm", entry: "explore", kind: "command", title: "탐구", reviewedHash: HASH },
    { plugin: "lint-kit", entry: "lint", kind: "skill", title: "린트", reviewedHash: HASH },
    { plugin: "notes", entry: "note", kind: "skill", title: "메모", reviewedHash: HASH },
  ];

  test("프로필 밖 항목만, Drive 플러그인은 Drive가 끝날 때까지, 드래프트는 따로 한 줄이다", async () => {
    const draftAsked: string[] = [];
    const container = await mount(
      <OneShotProbe />,
      withWorkbench({
        invocables: () => Promise.resolve(ok(ENTRIES)),
        pluginsInProfile: () => Promise.resolve(ok(new Set(["notes"]))),
        drafts: (name) => {
          draftAsked.push(name);
          return Promise.resolve(
            ok(
              name === "lint-kit"
                ? [
                    {
                      draftId: "drf_9",
                      name,
                      contentHash: `sha256:${"c".repeat(64)}`,
                      parent: null,
                      createdAt: "2026-11-18T09:00:00Z",
                      originThreadId: null,
                      label: null,
                      submittedItemId: null,
                    },
                  ]
                : [],
            ),
          );
        },
      }),
    );
    expect(draftAsked).toEqual(["helm", "lint-kit", "notes"]);
    const rows = [...container.querySelectorAll("li[role=option]")].map((li) => ({
      kind: li.getAttribute("data-one-shot"),
      text: li.textContent,
    }));
    expect(rows).toEqual([
      { kind: "release", text: `/explorehelm탐구${t("desktop.oneShot.untilDrive")}` },
      { kind: "turn", text: `/lintlint-kit린트${t("desktop.oneShot.turnOnly")}` },
      {
        kind: "draft",
        text: `/lint-kit${t("desktop.oneShot.draft")}${t("desktop.oneShot.draftHint")}`,
      },
    ]);
  });

  test("목록을 읽지 못하면 실패 상태다", async () => {
    const container = await mount(
      <OneShotProbe />,
      withWorkbench({
        invocables: () => Promise.resolve({ ok: false, error: { kind: "unsupported" } }),
      }),
    );
    expect(container.querySelector("[data-read]")?.getAttribute("data-read")).toBe("failed");
  });
});
