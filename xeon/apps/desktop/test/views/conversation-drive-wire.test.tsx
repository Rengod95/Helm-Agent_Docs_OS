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
import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { decodeDurable } from "../../src/state/engine/decode.ts";
import { createUiStore } from "../../src/state/ui/store.ts";
import type { Commands } from "../../src/views/commands.ts";
import { useDriveFrames } from "../../src/views/convo/drive-frames.ts";
import {
  DriveStackBand,
  DriveStackCards,
  type DriveStopControl,
} from "../../src/views/convo/drive-stack.tsx";
import { driveStackOf, type DriveLeaseFacts } from "../../src/views/convo/drive-stack-model.ts";
import type { BeamState } from "../../src/views/effects/beam.tsx";
import { OneShotRow, useOneShotSource } from "../../src/views/convo/one-shot.tsx";
import { oneShotRowsOf } from "../../src/views/convo/one-shot-model.ts";
import {
  ProfileChip,
  ProfileNotices,
  ProfileRows,
  resetLinesOf,
  useProfileChip,
  type ProfileChipDrive,
  type ProfileChipState,
} from "../../src/views/convo/profile-chip.tsx";
import { permissionModeNameOf } from "../../src/views/convo/turn-model.ts";
import { Providers } from "../../src/views/providers.tsx";
import { SUB, evt, openedHarness, summary, thr } from "../state/helpers.ts";
import { fakeCommands } from "./fake-commands.ts";

// lcM6a: 대화 화면 부품이 부르는 wire 메서드마다 "가짜 응답(상태) → 화면 글"을 본다. linkedom DOM 위에 실제 훅을 올린다.
// profile.list · profile.preview · thread.setProfile · profile.defaultFor · profile.default.reset → 프로필 칩·경고 줄·메뉴
// drive.frames · drive.framesChanged → Drive 스택 띠·판, 멈추기
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
/** 흉내 창의 이벤트 생성자(누르기를 보낸다) */
let DomEvent: typeof Event | null = null;

beforeAll(() => {
  const { window, document, Event } = parseHTML("<!doctype html><html><body></body></html>");
  DomEvent = Event;
  // 띠·판의 나타남은 motion 부품이다. 흉내 창에는 애니메이션이 없으므로 움직임 줄이기(그냥 그린다)로 둔다
  document.documentElement.setAttribute("data-motion", "reduce");
  // 띠의 빛(lcM6c)이 테마를 듣는다. 흉내 창의 matchMedia에는 듣기가 없어 다크 아님 + 빈 듣기로 둔다
  Object.defineProperty(window, "matchMedia", {
    value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
    configurable: true,
  });
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
  /** 프로필 칩이 보는 Drive 스택(입력창이 넘기는 값). 시험이 바꿔 다시 그린다 */
  let setDrive: ((drive: ProfileChipDrive) => void) | null = null;
  function ChipProbe(): ReactNode {
    const [drive, setDriveState] = useState<ProfileChipDrive>({ plugins: [], running: true });
    setDrive = setDriveState;
    const state = useProfileChip(
      T,
      (text) => {
        errors.push(text);
      },
      drive,
    );
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
    // 프로필 아이콘(한 벌 상자)의 변주: 스타트 Drive를 시작할 수 없으면 왼쪽 칸이 금 간 모양(lcM6c)
    expect(chip?.querySelector("[data-profile-glyph]")?.getAttribute("data-profile-glyph")).toBe(
      "blocked",
    );
    // 입력창 줄의 칩 문법: 상태는 아이콘·색으로만. 스타트 Drive가 막히면 칩 전체가 경고 색이다(권한 칩의 위험 색처럼)
    expect(chip?.getAttribute("data-state")).toBe("ready");
    expect(chip?.getAttribute("data-start-drive")).toBe("blocked");
    expect(chip?.className.includes("text-warning-text")).toBe(true);
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
    // 대기 중은 같은 상자에서 조각 하나가 빠진 변주다(lcM6c)
    expect(chip?.querySelector("[data-profile-glyph]")?.getAttribute("data-profile-glyph")).toBe(
      "pending",
    );
    expect(container.querySelector('[data-slot="profile-permission-notice"]')?.textContent).toBe(
      t("desktop.profileChip.permission", {
        from: permissionModeNameOf("default"),
        to: permissionModeNameOf("bypass"),
      }),
    );
  });

  test("전환한 프로필의 스타트 Drive가 미뤄지면(deferred) 조용한 줄을 보이고, 그 Drive가 스택에 서면 내린다(lcM6e)", async () => {
    const container = await mount(
      <ChipProbe />,
      withWorkbench({
        profiles: () => Promise.resolve(ok(PROFILES)),
        previewProfile: () => Promise.resolve(ok(preview([]))),
        applyProfile: () =>
          Promise.resolve(
            ok({
              position: { storeId: "sto_00000000000000000000000001", seq: 9 },
              preview: {},
              startDrive: "deferred",
            }),
          ),
      }),
    );
    await act(async () => {
      captured?.choose("review");
    });
    await settle();
    const line = container.querySelector('[data-slot="start-drive-deferred"]');
    expect([
      line?.textContent,
      line?.getAttribute("role"),
      container.querySelector("[data-problem-line]"),
    ]).toEqual([t("desktop.startDrive.deferred", { plugin: "helm" }), "status", null]);
    await act(async () => {
      setDrive?.({ plugins: ["helm"], running: true });
    });
    expect(container.querySelector('[data-slot="start-drive-deferred"]')).toBeNull();
    // 한 번 내린 안내는 Drive가 끝나 스택에서 빠져도 돌아오지 않는다
    await act(async () => {
      setDrive?.({ plugins: [], running: false });
    });
    expect(container.querySelector('[data-slot="start-drive-deferred"]')).toBeNull();
  });

  test("엔진이 스타트 Drive 시작을 거절하고(rejected) 까닭을 모르면 경고 줄로 알린다(lcM6e)", async () => {
    const container = await mount(
      <ChipProbe />,
      withWorkbench({
        profiles: () => Promise.resolve(ok(PROFILES)),
        previewProfile: () => Promise.resolve(ok(preview([]))),
        applyProfile: () =>
          Promise.resolve(
            ok({
              position: { storeId: "sto_00000000000000000000000001", seq: 9 },
              preview: {},
              startDrive: "rejected",
            }),
          ),
      }),
    );
    await act(async () => {
      captured?.choose("review");
    });
    await settle();
    expect(container.querySelector('[data-slot="start-drive-rejected"]')?.textContent).toBe(
      `${t("desktop.startDrive.rejected", { plugin: "helm" })}. ${t("desktop.startDrive.reason.refused")}. ${t("desktop.startDrive.fallback")}`,
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

function DriveProbe(props: {
  readonly stop?: DriveStopControl | null;
  readonly beam?: BeamState;
  readonly leases?: readonly DriveLeaseFacts[];
  readonly running?: boolean;
  readonly onOpenRecords?: (plugin: string) => void;
}): ReactNode {
  const read = useDriveFrames(T);
  if (read.kind !== "ready") return <p data-read={read.kind} />;
  const view = driveStackOf(read.frames);
  return (
    <>
      <DriveStackBand view={view} stop={props.stop ?? null} beam={props.beam ?? "off"} />
      <DriveStackCards
        view={view}
        stop={props.stop ?? null}
        leases={props.leases ?? []}
        running={props.running ?? false}
        onOpenRecords={props.onOpenRecords ?? null}
      />
    </>
  );
}

/** 카드 판을 위에서부터: [상태, 층, 이름] */
function cardsOf(container: HTMLElement): (string | null)[][] {
  return [...container.querySelectorAll('[data-slot="drive-stack"] [data-level]')].map((card) => [
    card.getAttribute("data-drive-step"),
    card.getAttribute("data-level"),
    card.querySelector("span.truncate")?.textContent ?? null,
  ]);
}

describe("Drive 스택: drive.frames · drive.framesChanged", () => {
  test("핸드오프하면 띠와 맨 위 판이 같은 말(Driving)을 쓰고, 판은 위에서부터 쌓이며, 알림이 오면 다시 읽는다", async () => {
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
    expect(band?.getAttribute("data-drive-top")).toBe("driving");
    expect(band?.querySelector('[data-slot="drive-band-state"]')?.textContent).toBe(
      t("desktop.drive.driving"),
    );
    expect(band?.textContent).toContain(t("desktop.convo.lead.turns", { used: 7, max: 8 }));
    // 띠는 넷만 보인다: 이름, 상태 글, 턴 수, 멈추기(도는 턴이 있을 때). 기다리는 수 "+1"과 정보 아이콘은 없다(lcM6d)
    expect(band?.querySelector('[data-slot="drive-band-name"]')?.textContent).toBe("verifier");
    expect(band?.querySelector('[data-slot="drive-band-turns"]')?.textContent).toBe(
      t("desktop.convo.lead.turns", { used: 7, max: 8 }),
    );
    expect(band?.querySelector('[data-slot="drive-band-below"]')).toBeNull();
    expect(band?.querySelector('[data-slot="info-tip"]')).toBeNull();
    expect(band?.querySelectorAll("[data-drive-step]").length).toBe(0);
    // 턴 막대는 한도 8이라 한 턴 한 칸이고, 쓴 7칸이 찬다(lcM6e)
    const track = band?.querySelector('[data-slot="drive-band-track"]');
    expect([
      track?.getAttribute("data-cells"),
      track?.querySelectorAll("[data-done]").length,
      track?.children.length,
    ]).toEqual(["8", 7, 8]);
    // 상태 글은 칩이 아니라 글이다(lcM6e). 빛이 꺼져 있으면(턴이 돌지 않음) 물결도 없다
    const word = band?.querySelector('[data-slot="drive-band-state"]');
    expect([
      word?.tagName,
      word?.getAttribute("data-variant") ?? null,
      word?.closest('[data-slot="chip"]') ?? null,
      word?.hasAttribute("data-wave"),
      word?.classList.contains("drive-wave"),
    ]).toEqual(["SPAN", null, null, false, false]);
    // 빛을 주지 않으면 꺼져 있다(판이 없다)
    expect(band?.getAttribute("data-beam")).toBe("off");
    expect(band?.querySelector(".fx-beam")).toBeNull();
    // 패널 판: 맨 위가 Drive를 쥔 칸, 맨 아래가 기본
    expect(cardsOf(container)).toEqual([
      ["driving", "0", "verifier"],
      ["waiting", "1", "helm"],
      ["waiting", "2", t("desktop.drive.core")],
    ]);
    const stack = container.querySelector('[data-slot="drive-stack"]');
    expect(stack?.getAttribute("data-depth")).toBe("3");
    // 띠와 패널은 맨 위 칸의 상태를 같은 글로 적는다
    expect(stack?.querySelector('[data-level="0"]')?.textContent).toContain(
      t("desktop.drive.driving"),
    );
    expect(
      [...container.querySelectorAll('[data-slot="drive-handoff-to"]')].map((el) => el.textContent),
    ).toEqual([
      t("desktop.drive.handedTo", { name: "verifier" }),
      // 기본 루프 판은 핸드오프 글 대신 "위 Drive가 끝나기를 기다림"이다(lcM6c)
    ]);

    frames = [frame(0, null, "waiting"), frame(1, "helm", "driving")];
    await act(async () => {
      notify.fire();
    });
    await settle();
    expect(container.querySelector('[data-slot="drive-band-state"]')?.textContent).toBe(
      t("desktop.drive.driving"),
    );
    expect(container.querySelector('[data-slot="drive-stack"]')?.getAttribute("data-depth")).toBe(
      "2",
    );
  });

  test("묻는 중이면 띠와 맨 위 판이 같은 경고 글을 쓴다", async () => {
    const container = await mount(
      <DriveProbe />,
      withWorkbench({
        driveFrames: () =>
          Promise.resolve(ok([frame(0, null, "waiting"), frame(1, "helm", "asking")])),
      }),
    );
    expect(container.querySelector('[data-slot="drive-band-state"]')?.textContent).toBe(
      t("desktop.drive.asking"),
    );
    expect(cardsOf(container)).toEqual([
      ["asking", "0", "helm"],
      ["waiting", "1", t("desktop.drive.core")],
    ]);
  });

  test("기본 루프만 돌면 띠가 없고 판은 기본 루프만 돈다고 적는다", async () => {
    const container = await mount(
      <DriveProbe />,
      withWorkbench({ driveFrames: () => Promise.resolve(ok([frame(0, null, "driving")])) }),
    );
    expect(container.querySelector('[data-slot="drive-stack-band"]')).toBeNull();
    expect(container.querySelector('[data-slot="drive-stack"]')?.textContent).toContain(
      t("desktop.drive.alone"),
    );
    expect(cardsOf(container)).toEqual([["driving", "0", t("desktop.drive.core")]]);
  });

  test("멈추기를 주면 띠와 맨 위 판에 멈추기가 있고, 누르면 그 함수를 부른다. 막혔으면 이유를 걸고 누를 수 없다", async () => {
    const pressed: string[] = [];
    const frames = [frame(0, null, "waiting"), frame(1, "helm", "driving")];
    const container = await mount(
      <DriveProbe
        stop={{ stopping: false, blockedReason: null, onStop: () => pressed.push("stop") }}
      />,
      withWorkbench({ driveFrames: () => Promise.resolve(ok(frames)) }),
    );
    const buttons = [...container.querySelectorAll('[data-slot="drive-stop"]')];
    // 띠에 하나, 맨 위 판에 하나. 아래 판에는 없다
    expect(buttons.length).toBe(2);
    expect(
      container.querySelector(
        '[data-slot="drive-stack"] [data-level="1"] [data-slot="drive-stop"]',
      ),
    ).toBeNull();
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
      t("desktop.drive.stopLabel"),
      t("desktop.drive.stopLabel"),
    ]);
    await act(async () => {
      if (DomEvent !== null) buttons[0]?.dispatchEvent(new DomEvent("click", { bubbles: true }));
    });
    expect(pressed).toEqual(["stop"]);

    const blocked = await mount(
      <DriveProbe stop={{ stopping: false, blockedReason: "엔진 없음", onStop: () => {} }} />,
      withWorkbench({ driveFrames: () => Promise.resolve(ok(frames)) }),
    );
    const off = blocked.querySelector('[data-slot="drive-stop"]');
    expect(off?.hasAttribute("disabled")).toBe(true);
    expect(off?.getAttribute("title")).toBe("엔진 없음");
  });

  test("멈추기가 없으면(턴이 돌지 않음) 버튼을 그리지 않는다", async () => {
    const container = await mount(
      <DriveProbe />,
      withWorkbench({
        driveFrames: () =>
          Promise.resolve(ok([frame(0, null, "waiting"), frame(1, "helm", "driving")])),
      }),
    );
    expect(container.querySelector('[data-slot="drive-stop"]')).toBeNull();
  });

  test("Drive가 턴을 돌리는 동안(빛 run)만 띠의 Driving이 물결이고, 묻는 중이면 물결 없이 경고색이다", async () => {
    const running = await mount(
      <DriveProbe beam="run" />,
      withWorkbench({
        driveFrames: () =>
          Promise.resolve(ok([frame(0, null, "waiting"), frame(1, "helm", "driving")])),
      }),
    );
    const live = running.querySelector('[data-slot="drive-band-state"]');
    expect([
      live?.textContent,
      live?.hasAttribute("data-wave"),
      live?.classList.contains("drive-wave"),
    ]).toEqual([t("desktop.drive.driving"), true, true]);
    const asking = await mount(
      <DriveProbe beam="run" />,
      withWorkbench({
        driveFrames: () =>
          Promise.resolve(ok([frame(0, null, "waiting"), frame(1, "helm", "asking")])),
      }),
    );
    const word = asking.querySelector('[data-slot="drive-band-state"]');
    expect([
      word?.hasAttribute("data-wave"),
      word?.classList.contains("text-warning-text"),
    ]).toEqual([false, true]);
  });

  test("턴 한도가 8을 넘으면 칸을 나누지 않은 막대다", async () => {
    const container = await mount(
      <DriveProbe />,
      withWorkbench({
        driveFrames: () =>
          Promise.resolve(
            ok([
              frame(0, null, "waiting"),
              frame(1, "helm", "driving", {
                used: { turns: 3, spawns: 0, tokens: 0 },
                limits: { turns: 20 },
              }),
            ]),
          ),
      }),
    );
    const track = container.querySelector(
      '[data-slot="drive-stack-band"] [data-slot="drive-band-track"]',
    );
    expect([track?.getAttribute("data-cells") ?? null, track?.getAttribute("data-slot")]).toEqual([
      null,
      "drive-band-track",
    ]);
    expect(container.querySelector('[data-slot="drive-band-turns-text"]')?.textContent).toBe(
      t("desktop.convo.lead.turns", { used: 3, max: 20 }),
    );
  });

  test("멈추기는 칩이 아니라 앱의 보통 단추(xs ghost)다", async () => {
    const container = await mount(
      <DriveProbe stop={{ stopping: false, blockedReason: null, onStop: () => {} }} />,
      withWorkbench({
        driveFrames: () =>
          Promise.resolve(ok([frame(0, null, "waiting"), frame(1, "helm", "driving")])),
      }),
    );
    expect(
      [...container.querySelectorAll('[data-slot="drive-stop"]')].map((b) => [
        b.tagName,
        b.getAttribute("data-size"),
        b.getAttribute("data-variant"),
        b.textContent,
      ]),
    ).toEqual([
      ["BUTTON", "xs", "ghost", t("desktop.drive.stop")],
      ["BUTTON", "xs", "ghost", t("desktop.drive.stop")],
    ]);
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

/** 카드의 넘겨받은 입력 줄 글(없으면 null)과 어떻게·언제부터 줄이 있는가 */
async function inputLineOf(
  frames: readonly DriveFrameView[],
  leases: readonly DriveLeaseFacts[],
): Promise<readonly (string | boolean | null)[]> {
  const container = await mount(
    <DriveProbe leases={leases} />,
    withWorkbench({ driveFrames: () => Promise.resolve(ok(frames)) }),
  );
  const card = container.querySelector('[data-slot="drive-card"]');
  return [
    card?.querySelector('[data-slot="drive-input"]')?.textContent ?? null,
    card?.querySelector('[data-slot="drive-origin"]') !== null,
  ];
}

describe("Drive 띠의 빛과 맨 위 판 카드(lcM6c)", () => {
  const HANDOFF = [
    frame(0, null, "waiting"),
    frame(1, "helm", "waiting"),
    frame(2, "verifier", "driving", {
      versionId: `sha256:${"ab12cd34".repeat(8)}`,
      used: { turns: 7, spawns: 0, tokens: 0 },
      limits: { turns: 8 },
    }),
  ];

  test("Drive가 턴을 돌리면 띠 윗변에 같은 빛(band 변형)이 켜지고, 답을 기다리면 경고 색 정지 선이다", async () => {
    const run = await mount(
      <DriveProbe beam="run" />,
      withWorkbench({ driveFrames: () => Promise.resolve(ok(HANDOFF)) }),
    );
    const band = run.querySelector('[data-slot="drive-stack-band"]');
    expect(band?.getAttribute("data-beam")).toBe("run");
    // 흉내 창은 움직임 줄이기라 살아 있는 빛 대신 정지 선(still)이다. 판은 띠 면 안에 있다
    const plate = band?.querySelector('[data-slot="drive-band-surface"] .fx-beam');
    expect([plate?.getAttribute("data-variant"), plate?.getAttribute("data-look")]).toEqual([
      "band",
      "still",
    ]);
    const wait = await mount(
      <DriveProbe beam="wait" />,
      withWorkbench({ driveFrames: () => Promise.resolve(ok(HANDOFF)) }),
    );
    expect(
      wait.querySelector('[data-slot="drive-band-surface"] .fx-beam')?.getAttribute("data-look"),
    ).toBe("wait");
  });

  test("카드에는 어떻게 쥐었나·언제부터 줄이 없고, 입력 인용은 명령·핸드오프로 쥔 칸에만 있다(lcM6d)", async () => {
    const facts = { leaseId: "lease-verifier", parent: null, branchesRunning: 0 };
    expect(
      await inputLineOf(HANDOFF, [{ ...facts, requestId: "req-1", inputLine: "검증해 줘" }]),
    ).toEqual(["검증해 줘", false]);
    expect(
      await inputLineOf(HANDOFF, [{ ...facts, requestId: null, inputLine: "검증해 줘" }]),
    ).toEqual([null, false]);
    expect(await inputLineOf(HANDOFF, [])).toEqual([null, false]);
  });

  test("카드 머리는 이름·판·상태 글, 넘겨받은 입력이고 몸은 하는 일과 한도(양만), 발은 다음 칸과 기록 보기다", async () => {
    const opened: string[] = [];
    const container = await mount(
      <DriveProbe
        running
        leases={[
          {
            leaseId: "lease-verifier",
            parent: "lease-helm",
            requestId: "req-1",
            inputLine: "결과를 검증해 줘",
            branchesRunning: 2,
          },
        ]}
        onOpenRecords={(plugin) => opened.push(plugin)}
      />,
      withWorkbench({ driveFrames: () => Promise.resolve(ok(HANDOFF)) }),
    );
    const card = container.querySelector('[data-slot="drive-card"]');
    const text = (slot: string): string | null =>
      card?.querySelector(`[data-slot="${slot}"]`)?.textContent ?? null;
    expect([
      card?.getAttribute("data-activity"),
      text("drive-version"),
      text("drive-card-state"),
      card?.querySelector('[data-slot="drive-card-state"]')?.hasAttribute("data-wave") ?? null,
      text("drive-input"),
      text("drive-activity"),
      text("drive-next"),
      card?.querySelector('[data-drive-meter="turns"]')?.textContent ?? null,
    ]).toEqual([
      "turn",
      "ab12cd3",
      t("desktop.drive.driving"),
      // 턴이 도는 동안 카드의 "Driving"은 물결 글이다(lcM6e)
      true,
      "결과를 검증해 줘",
      `${t("desktop.drive.card.turn")} · ${t("desktop.drive.card.branches", { n: 2 })}`,
      t("desktop.drive.card.next", { name: "helm" }),
      "7/8",
    ]);
    const records = card?.querySelector('[data-slot="drive-records"]');
    expect(records?.textContent).toBe(t("desktop.drive.card.records"));
    await act(async () => {
      if (DomEvent !== null) records?.dispatchEvent(new DomEvent("click", { bubbles: true }));
    });
    expect(opened).toEqual(["verifier"]);
  });

  test("드래프트 Drive는 카드에만 드래프트 칩이 붙고(띠는 넷만), 기록으로 갈 곳이 없으면 단추가 없다", async () => {
    const container = await mount(
      <DriveProbe />,
      withWorkbench({
        driveFrames: () =>
          Promise.resolve(
            ok([
              frame(0, null, "waiting"),
              frame(1, "helm", "driving", { versionId: "draft:drf_1:0a1b2c3d" }),
            ]),
          ),
      }),
    );
    expect(
      [...container.querySelectorAll('[data-slot="drive-draft"]')].map((chip) => chip.textContent),
    ).toEqual([t("desktop.oneShot.draft")]);
    expect(
      container.querySelector('[data-slot="drive-stack-band"] [data-slot="drive-draft"]'),
    ).toBeNull();
    const card = container.querySelector('[data-slot="drive-card"]');
    expect(card?.querySelector('[data-slot="drive-version"]')).toBeNull();
    expect(card?.querySelector('[data-slot="drive-records"]')).toBeNull();
    // 턴이 없으면 다음 말이 그 플러그인에 간다고 적는다
    expect(card?.querySelector('[data-slot="drive-activity"]')?.textContent).toBe(
      t("desktop.drive.card.holding", { name: "helm" }),
    );
    expect(card?.textContent).toContain(t("desktop.drive.card.noLimits"));
  });

  test("한도 90%를 넘으면 카드의 한도 줄이 경고이고, 답을 기다리는 칸은 하는 일 줄이 경고 글이다", async () => {
    const container = await mount(
      <DriveProbe />,
      withWorkbench({
        driveFrames: () =>
          Promise.resolve(
            ok([
              frame(0, null, "waiting"),
              frame(1, "helm", "asking", {
                used: { turns: 11, spawns: 0, tokens: 0 },
                limits: { turns: 12 },
              }),
            ]),
          ),
      }),
    );
    const card = container.querySelector('[data-slot="drive-card"]');
    expect(card?.querySelector('[data-drive-meter="turns"]')?.hasAttribute("data-warn")).toBe(true);
    const activity = card?.querySelector('[data-slot="drive-activity"]');
    expect([activity?.textContent, activity?.className.includes("text-warning-text")]).toEqual([
      t("desktop.drive.card.asking"),
      true,
    ]);
  });
});
