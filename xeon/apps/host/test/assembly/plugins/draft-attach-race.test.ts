import { expect, test } from "bun:test";
import { err, ok, parse, type Result } from "@fresnel/contracts";
import { ThreadIdSchema, type ThreadId } from "@fresnel/contracts/conversation";
import {
  internalDraftName,
  type LoadInstalledStarted,
  type RegistrationToggleSourceOf,
} from "@fresnel/ext-host";
import { createPluginSet, type PluginLifecycle } from "../../../src/assembly/m4/plugin-set.ts";
import {
  createDraftLoader,
  type DraftLoaderPort,
} from "../../../src/assembly/plugins/draft-load.ts";
import {
  createOverlayPort,
  type DraftRef,
  type OverlayTarget,
} from "../../../src/assembly/plugins/overlay.ts";
import type { PluginPortFailure } from "../../../src/handlers/m5/plugins.ts";
import { partial } from "../../fixtures/unsafe.ts";

// 초안 내리기와 붙이기의 경쟁(M5c §4.3.8, §4.1.11). 대화 A가 정착하면 초안 내리기가 큐에 든다. 그 내리기가 끝나기 전에 대화 B가
// 같은 초안을 얹으면, 싣기가 "이미 실림"으로 건너뛰고 뒤의 내리기가 그것을 지워 B의 표지에 실행 중인 초안이 없게 된다.
// 시험의 로더는 내리기가 끝나야 기록을 지운다(실제 `unloadDraft`가 호스트에서 내린 뒤 지우는 것과 같다). 내리기는 시험이 늦게 푼다.

const DRAFT: DraftRef = {
  name: "widget",
  draftId: "drf-1",
  contentHash: `sha256:${"d".repeat(64)}`,
  tree: "/drafts/drf-1/tree",
};
const INTERNAL = "ddrf1-widget";

/** 대기 중인 비동기 작업이 모두 한 바퀴 돌도록 매크로태스크 몇 번을 기다린다 */
/** 매크로태스크 한 바퀴를 세 번 기다린다(대기 중인 비동기 작업이 모두 돌도록) */
async function settle(): Promise<void> {
  await tick();
  await tick();
  await tick();
}

function tick(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function threadOf(text: string): ThreadId {
  const parsed = parse(ThreadIdSchema, text);
  if (!parsed.ok) throw new Error("fixture thread id is invalid");
  return parsed.value;
}

/** 내리기를 시험이 풀 때까지 붙잡는 로더. `loaded`는 실린 내부 이름이다 */
function lateUnloadLoader(): {
  readonly port: DraftLoaderPort;
  readonly loaded: Set<string>;
  readonly unloads: string[];
  /** 붙잡은 내리기를 모두 끝낸다 */
  finishUnloads(): void;
} {
  const loaded = new Set<string>();
  const unloads: string[] = [];
  const pending: (() => void)[] = [];
  const port: DraftLoaderPort = {
    loadDraft: (input) => {
      loaded.add(internalDraftName(input.plugin, input.draftId));
      return Promise.resolve(ok(partial<LoadInstalledStarted>({ appliesAt: "now" })));
    },
    unloadDraft: (name) => {
      unloads.push(name);
      return new Promise<boolean>((resolve) => {
        pending.push(() => {
          loaded.delete(name);
          resolve(true);
        });
      });
    },
    draftOf: (name) =>
      loaded.has(name)
        ? {
            internalName: name,
            plugin: DRAFT.name,
            draftId: DRAFT.draftId,
            contentHash: DRAFT.contentHash,
          }
        : undefined,
  };
  return {
    port,
    loaded,
    unloads,
    finishUnloads: () => {
      for (const finish of pending.splice(0)) finish();
    },
  };
}

test("다른 대화가 내리기 중인 초안을 얹으면 내리기가 끝난 뒤 다시 실어 표지가 실행 중인 초안을 가리킨다", async () => {
  const loader = lateUnloadLoader();
  const reports: string[] = [];
  const toggles: RegistrationToggleSourceOf = {
    scopes: () => [],
    request: () => undefined,
    requestApply: () => undefined,
    applyNow: () => Promise.resolve(),
  };
  // 적재 기록(`ensureLoaded`)은 로더가 아는 이름만 받는다. 모르는 이름은 실패로 보고된다
  const lifecycle: PluginLifecycle = {
    ensureLoaded: (name) => {
      if (loader.loaded.has(name)) return Promise.resolve(undefined);
      return Promise.reject(new Error(`${name} is not loaded`));
    },
    unload: (name) => loader.port.unloadDraft(name),
  };
  const set = createPluginSet({
    profiles: {
      list: () =>
        Promise.resolve(
          ok({
            profiles: [],
            common: { plugins: [], settings: [], updatedAt: "2026-11-18T00:00:00.000Z", rev: 1 },
            rev: 1,
          }),
        ),
      onProfilesWritten: () => () => undefined,
    },
    threadProfileId: () => null,
    openThreadIds: () => [],
    managedOff: () => false,
    registrations: () => [],
    loadedHash: () => undefined,
    forcedPlugins: () => [],
    defaultPlugins: () => [],
    stopped: () => false,
    settingsChanged: () => undefined,
    toggles,
    driveFramePlugins: () => [],
    whenIdle: (_id, fn) => fn(),
    driveFramesChanged: () => () => undefined,
    report: (message) => reports.push(message),
    lifecycle,
  });
  // 저장된 프로필 목록을 한 번 읽어야 집합을 셀 수 있다(열린 대화의 실제 순서와 같다)
  await set.refresh();
  const load = createDraftLoader({
    loader: () => loader.port,
    report: (event) => reports.push(event),
    timeoutMs: 1_000,
  });
  const overlay = createOverlayPort({
    targetOf: (name): Promise<Result<OverlayTarget | undefined, PluginPortFailure>> =>
      Promise.resolve(ok({ name, reviewedHash: null, entries: [], addsTools: false })),
    draftOf: () => Promise.resolve(ok(DRAFT)),
    loadDrafts: load,
    inSet: () => [],
    ensureLoaded: () => Promise.resolve(),
    pluginSet: {
      attachOverlay: (threadId, marks) => set.attachOverlay(threadId, marks),
      cancelOverlay: (threadId, keepDrive) => set.cancelOverlay(threadId, keepDrive),
      hold: (names) => set.hold(names),
    },
    startDrive: () => err({ kind: "no_drive" }),
  });
  const threadA = threadOf("thr_01ARZ3NDEKTSV4RRFFQ69G5FA1");
  const threadB = threadOf("thr_01ARZ3NDEKTSV4RRFFQ69G5FA2");
  // 대화 A가 초안을 얹고 정착한다. 정착은 내리기를 큐에 넣고, 시험이 그 내리기를 붙잡는다
  expect((await overlay.attach(threadA, [{ plugin: DRAFT.name, draftId: DRAFT.draftId }])).ok).toBe(
    true,
  );
  set.port.turnSettled?.(threadA);
  await settle();
  expect(loader.unloads).toEqual([INTERNAL]);
  // 대화 B가 같은 초안을 얹는다. 내리기가 아직 끝나지 않았다
  const attaching = overlay.attach(threadB, [{ plugin: DRAFT.name, draftId: DRAFT.draftId }]);
  // B가 할 수 있는 일을 모두 하게 둔다(내리기는 아직 끝나지 않았다). 고치지 않은 얹기는 여기서 "이미 실림"으로 건너뛴다
  await settle();
  loader.finishUnloads();
  const attached = await attaching;
  // 시험의 경계: 얹기는 성공하고, 초안은 실린 채 B의 집합에 든다. 적재 실패는 없다
  expect(attached.ok).toBe(true);
  expect(loader.loaded.has(INTERNAL)).toBe(true);
  expect(set.port.resolve(threadB).plugins).toContain(INTERNAL);
  expect(set.port.resolve(threadB).overlay).toEqual([
    { plugin: DRAFT.name, contentHash: DRAFT.contentHash, until: "turn", draftId: DRAFT.draftId },
  ]);
  expect(reports).toEqual([]);
});
