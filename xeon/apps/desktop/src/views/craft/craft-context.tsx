// 크래프트 개요의 화면 상태와 바깥과 닿는 자리(포트). 세 보기(지도·순서·링크)와 자세히 보기가 같은 값을 읽는다.
// 데이터는 `CraftSource`가 준다. 엔진 연결(T-BENCH)이 오기 전에는 고정 데이터나 빈 상태를 넣는다.
import {
  clearSel,
  selectGroup,
  selectPlugin,
  type CanvasSnapshot,
  type Contrib,
  type HookOrderPort,
  type KindFilter,
  type Sel,
  type SelState,
} from "@fresnel/client/workbench/canvas";
import { createContext, useContext, useMemo, useReducer, type ReactNode } from "react";
import { assertNever, Bug } from "@fresnel/contracts";

export type CraftMode = "orbit" | "strata" | "link";

/** 최근 실행 한 줄(`trace.turn` 한 칸). `sec`은 턴 시작부터의 초 */
export interface CraftRunEntry {
  readonly hook: string;
  readonly registrationId: string;
  readonly sec: number;
  readonly ms: number;
  readonly result: "ok" | "error" | "over_budget" | "denied" | "skipped";
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
}

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

export const initialCraftState: CraftState = {
  ...clearSel(),
  mode: "orbit",
  kind: "all",
  contrib: [],
  detail: null,
  query: "",
};

export function craftReducer(state: CraftState, action: CraftAction): CraftState {
  switch (action.t) {
    case "mode":
      return { ...state, mode: action.mode };
    case "kind":
      return { ...state, kind: action.kind };
    case "contrib":
      return {
        ...state,
        contrib: state.contrib.includes(action.contrib)
          ? state.contrib.filter((c) => c !== action.contrib)
          : [...state.contrib, action.contrib],
      };
    case "selectPlugin":
      return { ...state, ...selectPlugin(action.id) };
    case "selectGroup":
      return { ...state, ...selectGroup(action.id) };
    case "selectOther":
      return { ...state, sel: action.sel, panel: true };
    case "clear":
      return { ...state, ...clearSel() };
    case "detail":
      return { ...state, detail: action.id };
    case "query":
      return { ...state, query: action.query };
    default:
      return assertNever(action, "craftReducer");
  }
}

interface CraftValue {
  readonly source: CraftSource;
  readonly state: CraftState;
  readonly dispatch: (action: CraftAction) => void;
}

const CraftContext = createContext<CraftValue | null>(null);

export function CraftProvider(props: {
  readonly source: CraftSource;
  readonly children: ReactNode;
}): ReactNode {
  const [state, dispatch] = useReducer(craftReducer, initialCraftState);
  const value = useMemo(() => ({ source: props.source, state, dispatch }), [props.source, state]);
  return <CraftContext.Provider value={value}>{props.children}</CraftContext.Provider>;
}

export function useCraft(): CraftValue {
  const value = useContext(CraftContext);
  if (value === null) throw new Bug("useCraft called outside CraftProvider");
  return value;
}
