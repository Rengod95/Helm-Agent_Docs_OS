import type { Result } from "@fresnel/contracts";
import type { EngineTarget, RestoreReport } from "../../../transport/ipc.ts";
import type { RestoreCommands, RestoreRefusal } from "../../commands.ts";

// 설정 고급 탭의 데이터 복원 구역(P-09)의 상태와 흐름. 그림은 `settings-restore-view.tsx`, 화면 연결은 `settings-restore-screen.tsx`.
// 흐름은 컨트롤러 하나가 든다(`createRestoreController`). 확인 대화 상자를 열고, 취소하면 아무것도 부르지 않고, 확인하면 명령을 한 번 부른다.
// 시험은 DOM 없이 이 컨트롤러의 입구(edit, ask, cancel, confirm)로 같은 흐름을 본다.

export type RestorePhase =
  | { readonly kind: "idle" }
  | { readonly kind: "running" }
  | { readonly kind: "restored"; readonly report: RestoreReport }
  | { readonly kind: "refused"; readonly refusal: RestoreRefusal };

export interface RestoreState {
  /** 입력창의 글. 보낼 때 양쪽 빈칸을 뗀다 */
  readonly path: string;
  /** 이 앱이 아는 엔진 대상. `null`이면 모른다 */
  readonly target: EngineTarget | null;
  /** 확인 대화 상자가 열려 있다 */
  readonly asking: boolean;
  readonly phase: RestorePhase;
}

/** 복원 단추를 막는 까닭. `null`이면 누를 수 있다. `running`은 진행 중이라는 뜻이다 */
export type RestoreBlock = "running" | "remote" | "blank";

/** 단추가 막히는 까닭. 진행 중이 가장 먼저고, 원격이 그다음, 입력이 비었는지가 마지막이다 */
export function restoreBlockOf(
  state: Pick<RestoreState, "path" | "target" | "phase">,
): RestoreBlock | null {
  if (state.phase.kind === "running") return "running";
  // 대상을 아직 모르면(앱이 보낸 적 없음) 셸 기본값 로컬로 본다. 원격이면 셸이 `remote-target`으로 거절한다
  if (state.target?.kind === "remote") return "remote";
  if (state.path.trim() === "") return "blank";
  return null;
}

export interface RestoreController {
  readonly getState: () => RestoreState;
  readonly subscribe: (listener: () => void) => () => void;
  readonly edit: (path: string) => void;
  /** 확인 대화 상자를 연다. 막혀 있으면 열지 않고 막힌 까닭만 새로 읽는다 */
  readonly ask: () => void;
  /** 확인 대화 상자를 닫는다. 명령은 부르지 않는다 */
  readonly cancel: () => void;
  /** 확인이다. 막혀 있지 않으면 입력의 양쪽 빈칸을 뗀 경로로 `run`을 한 번 부른다 */
  readonly confirm: () => Promise<void>;
}

export interface RestoreControllerOptions {
  /** 복원이 끝나면(되돌렸거나 거절) 한 번 부른다. 화면은 성공 토스트를 여기서 띄운다 */
  readonly settled?: (phase: RestorePhase) => void;
}

export function createRestoreController(
  port: Pick<RestoreCommands, "engineTarget" | "run">,
  options: RestoreControllerOptions = {},
): RestoreController {
  let state: RestoreState = {
    path: "",
    target: port.engineTarget(),
    asking: false,
    phase: { kind: "idle" },
  };
  const listeners = new Set<() => void>();
  const set = (next: RestoreState): void => {
    state = next;
    for (const listener of listeners) listener();
  };
  // 엔진 대상은 화면이 열린 뒤에 바뀔 수 있으므로 판단 전에 다시 읽는다
  const refreshed = (): RestoreState => ({ ...state, target: port.engineTarget() });

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    edit: (path) => {
      set({ ...state, path });
    },
    ask: () => {
      const next = refreshed();
      set(restoreBlockOf(next) === null ? { ...next, asking: true } : next);
    },
    cancel: () => {
      set({ ...state, asking: false });
    },
    confirm: async () => {
      const next = { ...refreshed(), asking: false };
      if (restoreBlockOf(next) !== null) {
        set(next);
        return;
      }
      set({ ...next, phase: { kind: "running" } });
      const result: Result<RestoreReport, RestoreRefusal> = await port.run(next.path.trim());
      const phase: RestorePhase = result.ok
        ? { kind: "restored", report: result.value }
        : { kind: "refused", refusal: result.error };
      set({ ...state, phase });
      options.settled?.(phase);
    },
  };
}
