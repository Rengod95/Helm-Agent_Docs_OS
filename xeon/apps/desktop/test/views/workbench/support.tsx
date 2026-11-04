// 크래프트 화면 시험의 공용 도구: `ext.list` 모양의 항목, 세 provider(엔진·명령·워크벤치 스토어)로 감싸기.
import type { ReactNode } from "react";
import { listLoaded, type WorkbenchState } from "@fresnel/client/workbench";
import type { ExtListEntry } from "@fresnel/contracts/wire";
import { EngineStoreContext } from "../../../src/state/engine/index.ts";
import { reduceMirror } from "../../../src/state/engine/reduce.ts";
import { createShellStore, ShellStoreContext } from "../../../src/state/shell/index.ts";
import { createUiStore, UiStoreContext } from "../../../src/state/ui/index.ts";
import { INITIAL_MIRROR, type EngineMirror } from "../../../src/state/engine/state.ts";
import type { ReadonlyStore } from "../../../src/state/shared/readonly-store.ts";
import {
  createWorkbenchStore,
  WorkbenchStoreContext,
  type WorkbenchStore,
} from "../../../src/state/workbench/index.ts";
import { CommandsContext } from "../../../src/views/commands.ts";
import type { PluginUiContextValue } from "../../../src/views/plugin/plugin-context.tsx";
import { PluginUiProvider } from "../../../src/views/plugin/plugin-context.tsx";
import { harness, STORE, SUB } from "../../state/helpers.ts";
import { fakeCommands } from "../fake-commands.ts";
import { emptyPluginUi } from "../plugin/support.tsx";

export function entry(name: string, over: Partial<ExtListEntry> = {}): ExtListEntry {
  return {
    name,
    displayName: name,
    layer: "L2",
    isGroup: false,
    version: "1.0.0",
    location: "/x",
    origin: "user",
    requestedGrade: "user",
    effectiveGrade: "user",
    tier: null,
    status: "enabled",
    // 루트 플러그인의 등록 id는 확장 이름이다(README: 루트면 확장 이름, 구성원이면 "<확장>/<id>")
    plugins: [{ registrationId: name, layer: "L2", status: "enabled", inGroup: false }],
    diagnostics: [],
    autoDisabled: false,
    safeModeExcluded: null,
    hookCount: 2,
    ...over,
  };
}

/** 여러 번 시작하며 자동으로 꺼져 "계속 꺼 둘까요?"를 묻는 확장(기본은 그룹 review, 시작 3번) */
export function askingEntry(over: Partial<ExtListEntry> = {}): ExtListEntry {
  return entry("review", {
    layer: "L3",
    isGroup: true,
    status: "disabled",
    autoDisabled: true,
    keepOffQuestion: { disabledStarts: 3 },
    ...over,
  });
}

/** 확장 셋. 코어 하나(잠김), 웹 검색(표시 이름이 다름), 그룹 review(구성원 둘, 자동 꺼짐) */
const ENTRIES: readonly ExtListEntry[] = [
  entry("core-loop", { layer: "L1", tier: "core", origin: "builtin" }),
  entry("web", { displayName: "웹 검색" }),
  entry("review", {
    layer: "L3",
    isGroup: true,
    status: "disabled",
    autoDisabled: true,
    plugins: [
      { registrationId: "review", layer: "L3", status: "disabled", inGroup: true },
      { registrationId: "review/lint", id: "lint", layer: "L3", status: "disabled", inGroup: true },
    ],
  }),
];

/** 목록을 읽은 워크벤치 스토어. `prepare`로 고른 것·자세히·캐시를 더한다 */
export function screenStore(
  prepare: (state: WorkbenchState) => WorkbenchState = (state) => state,
): WorkbenchStore {
  return createWorkbenchStore((initial) => prepare(listLoaded(initial, ENTRIES)));
}

/**
 * 주어진 거울을 읽기 면으로 준다. 서버 렌더는 `getInitialState`를 읽으므로 두 값을 같은 거울로 둔다.
 * (zustand는 스토어 폴더에서만 import한다: FS-06. 읽기 면의 모양만 흉내 낸다.)
 */
export function seededEngine(mirror: EngineMirror): ReadonlyStore<EngineMirror> {
  return {
    getState: () => mirror,
    getInitialState: () => mirror,
    subscribe: () => () => undefined,
  };
}

/**
 * 연결이 살아 있는(live) 엔진 거울의 읽기 면. 띠가 오프라인 글 대신 목록 상태를 보이게 한다.
 * 구독 입력 하나로 거울을 만든다.
 */
export function liveEngine(): ReadonlyStore<EngineMirror> {
  return seededEngine(
    reduceMirror(INITIAL_MIRROR, {
      type: "subscribed",
      sub: SUB,
      storeId: STORE,
      start: 5,
      live: true,
      from: "head",
    }).state,
  );
}

/**
 * 엔진·명령·워크벤치 스토어·플러그인 문맥 provider로 감싼다. 화면이 읽는 문맥을 모두 채운다.
 * 엔진은 기본으로 끊긴 거울이고, 플러그인 문맥은 기본으로 빈 목록이다
 */
export function inContexts(
  ui: ReactNode,
  store: WorkbenchStore,
  engine: ReadonlyStore<EngineMirror> = harness().store.read,
  plugin: PluginUiContextValue = emptyPluginUi(),
): ReactNode {
  return (
    <EngineStoreContext value={engine}>
      <ShellStoreContext value={createShellStore(1400)}>
        <UiStoreContext value={createUiStore().read}>
          <CommandsContext value={fakeCommands()}>
            <WorkbenchStoreContext value={store}>
              <PluginUiProvider value={plugin}>{ui}</PluginUiProvider>
            </WorkbenchStoreContext>
          </CommandsContext>
        </UiStoreContext>
      </ShellStoreContext>
    </EngineStoreContext>
  );
}
