// 크래프트 개요의 바깥과 닿는 자리. 화면 상태는 따로 두지 않고 워크벤치 스토어(`state/workbench`)에서 읽고 쓴다.
// 세 보기(지도·순서·링크)와 자세히 보기가 같은 값을 읽는다. 데이터는 `CraftSource`가 주고(`useCraftSource`가 스토어와 명령에서 만든다).
import type {
  CanvasSnapshot,
  Contrib,
  HookOrderPort,
  KindFilter,
  Sel,
  SelState,
} from "@fresnel/client/workbench/canvas";
import type { WorkbenchState, WorkbenchView } from "@fresnel/client/workbench";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { assertNever, Bug } from "@fresnel/contracts";
import type { TraceFailureReason, TraceHandlerResult } from "@fresnel/contracts/extensions";
import { useShallow } from "zustand/react/shallow";
import {
  useWorkbench,
  useWorkbenchActions,
  type CraftScope,
  type WorkbenchActions,
} from "../../state/workbench/index.ts";

/** 세 보기 중 하나. 스토어의 `view`와 같은 값이다 */
export type CraftMode = WorkbenchView;

/** 최근 실행 한 줄(`trace.turn`의 훅 한 칸에서 핸들러 하나). 턴 안의 순서는 wire의 seq 순서다 */
export interface CraftRunEntry {
  readonly hook: string;
  readonly registrationId: string;
  readonly ms: number;
  readonly result: TraceHandlerResult;
  /** `failed`의 이유. 그 밖의 결과에서는 null */
  readonly reason: TraceFailureReason | null;
}

export interface CraftSource {
  readonly snapshot: CanvasSnapshot;
  /** 훅별 적용 중인 핸들러 순서(Registration id). `hooks.order.get`의 applied */
  readonly order: Readonly<Record<string, readonly string[]>>;
  /** 그룹 하나의 스위치. 대상은 `toggleTargets`가 준 id들(그룹 단위, 15-1) */
  readonly setOn: (ids: readonly string[], on: boolean) => Promise<void>;
  readonly orderPort: HookOrderPort;
  /** 만들기(빌더)를 연다. 훅을 주면 그 훅을 고른 채로 연다(15-3) */
  readonly openBuilder: (hook: string | null) => void;
  /** 최근 실행. 계측이 꺼져 있으면 `null`(자세히 보기에서 잠김) */
  readonly recentRuns: (pluginId: string) => Promise<readonly CraftRunEntry[] | null>;
  /** 데이터 범위. 지금은 전역뿐이고 스토어가 정한다(`craft-scope.ts`의 `scopeArg`가 호출 인자로 옮긴다) */
  readonly scope: CraftScope;
}

/**
 * 캔버스가 읽는 화면 상태. 스토어 상태에서 뽑은 읽기 전용 모양이고 따로 저장하지 않는다.
 * `mode`는 스토어의 `view`, 나머지는 같은 이름의 필드다.
 */
export interface CraftState extends SelState {
  readonly mode: CraftMode;
  readonly kind: KindFilter;
  /** 구성 요소 필터. 비어 있으면 전부 */
  readonly contrib: readonly Contrib[];
  /** 자세히 보기로 캔버스를 바꾼 대상(플러그인 또는 그룹 id) */
  readonly detail: string | null;
  /** 찾기 칸의 글 */
  readonly query: string;
}

/** 캔버스가 내는 동작. 값을 바꾸는 일은 `craftDispatch`가 스토어 동작으로 옮긴다 */
export type CraftAction =
  | { readonly t: "mode"; readonly mode: CraftMode }
  | { readonly t: "kind"; readonly kind: KindFilter }
  | { readonly t: "contrib"; readonly contrib: Contrib }
  | { readonly t: "selectPlugin"; readonly id: string }
  | { readonly t: "selectGroup"; readonly id: string }
  | { readonly t: "selectOther"; readonly sel: Sel }
  | { readonly t: "clear" }
  | { readonly t: "detail"; readonly id: string | null }
  | { readonly t: "query"; readonly query: string };

/** 스토어 상태에서 캔버스가 읽는 값만 뽑는다. 필드 값은 스토어의 것을 그대로 가리킨다 */
export function craftStateOf(s: WorkbenchState): CraftState {
  return {
    mode: s.view,
    kind: s.kind,
    contrib: s.contrib,
    detail: s.detail,
    query: s.query,
    sel: s.sel,
    panel: s.panel,
  };
}

/** 캔버스 동작 하나를 스토어 동작 하나로 옮긴다. `mode`는 `setView`라서 자세히 보기를 닫는다(툴바는 자세히 보기 중에 없다) */
export function craftDispatch(actions: WorkbenchActions, action: CraftAction): void {
  switch (action.t) {
    case "mode":
      actions.setView(action.mode);
      return;
    case "kind":
      actions.setKind(action.kind);
      return;
    case "contrib":
      actions.toggleContrib(action.contrib);
      return;
    case "selectPlugin":
      actions.pickPlugin(action.id);
      return;
    case "selectGroup":
      actions.pickGroup(action.id);
      return;
    case "selectOther":
      actions.pickSel(action.sel);
      return;
    case "clear":
      actions.clearPick();
      return;
    case "detail":
      if (action.id === null) actions.closeDetail();
      else actions.openDetail(action.id);
      return;
    case "query":
      actions.setQuery(action.query);
      return;
    default:
      return assertNever(action, "craftDispatch");
  }
}

interface CraftValue {
  readonly source: CraftSource;
  readonly state: CraftState;
  readonly dispatch: (action: CraftAction) => void;
}

const CraftContext = createContext<CraftValue | null>(null);

/** 워크벤치 스토어 provider 안에서 쓴다. 캔버스 상태가 바뀌면 이 값을 다시 만든다 */
export function CraftProvider(props: {
  readonly source: CraftSource;
  readonly children: ReactNode;
}): ReactNode {
  const state = useWorkbench(useShallow(craftStateOf));
  const actions = useWorkbenchActions();
  const value = useMemo(
    (): CraftValue => ({
      source: props.source,
      state,
      dispatch: (action) => {
        craftDispatch(actions, action);
      },
    }),
    [props.source, state, actions],
  );
  return <CraftContext.Provider value={value}>{props.children}</CraftContext.Provider>;
}

export function useCraft(): CraftValue {
  const value = useContext(CraftContext);
  if (value === null) throw new Bug("useCraft called outside CraftProvider");
  return value;
}
