import type { MessageId } from "@fresnel/client/i18n";
import type { BackupReport, EngineTarget } from "../../../transport/ipc.ts";
import type { StorageCommands, StorageFailure } from "../../commands.ts";
import { checkWorkspaceInput } from "../../workspace-model.ts";

// 설정 고급 탭의 백업 만들기 구역(P-09)의 상태와 흐름. 그림은 `settings-backup-view.tsx`, 화면 연결은 `settings-backup-screen.tsx`.
// 흐름은 컨트롤러 하나가 든다(`createBackupController`). 확인 대화 상자를 열고, 취소하면 아무것도 부르지 않고, 확인하면 명령을 한 번 부른다.
// 복원 구역(`settings-restore-model.ts`)과 같은 모양이다. 시험은 DOM 없이 이 컨트롤러의 입구(edit, ask, cancel, confirm)로 본다.

/** 백업이 들고 나가는 것, 빼는 것, age 키 안내의 글 id. 백업 구역, 복원 구역의 설명이 같은 글을 쓴다 */
export const BACKUP_NOTE_IDS: readonly MessageId[] = [
  "desktop.settings.backup.note.included",
  "desktop.settings.backup.note.excluded",
  "desktop.settings.backup.note.ageKey",
];

export type BackupPhase =
  | { readonly kind: "idle" }
  | { readonly kind: "running" }
  | { readonly kind: "done"; readonly report: BackupReport }
  | { readonly kind: "refused"; readonly failure: StorageFailure };

export interface BackupState {
  /** 입력창의 글(백업을 만들 상위 폴더). 보낼 때 양쪽 빈칸을 뗀다 */
  readonly parent: string;
  /** 이 앱이 아는 엔진 대상. `null`이면 모른다 */
  readonly target: EngineTarget | null;
  /** 확인 대화 상자가 열려 있다 */
  readonly asking: boolean;
  readonly phase: BackupPhase;
}

/** 단추를 막는 까닭. `null`이면 누를 수 있다. `running`은 진행 중이라는 뜻이다 */
export type BackupBlock = "running" | "remote" | "blank" | "relative";

/** 단추가 막히는 까닭. 진행 중이 가장 먼저고, 원격이 그다음, 입력이 비었는지, 상대 경로인지가 마지막이다 */
export function backupBlockOf(
  state: Pick<BackupState, "parent" | "target" | "phase">,
): BackupBlock | null {
  if (state.phase.kind === "running") return "running";
  // 대상을 아직 모르면(앱이 보낸 적 없음) 셸 기본값 로컬로 본다. 원격이면 이 기기의 데이터 폴더를 가리키지 않으니 막는다
  if (state.target?.kind === "remote") return "remote";
  const input = checkWorkspaceInput(state.parent);
  if (input.kind === "none") return "blank";
  // 상대 경로는 사이드카의 작업 디렉터리(홈) 기준으로 읽혀 엉뚱한 폴더에 만들 수 있어 화면에서 막는다
  if (input.kind === "invalid" && input.reason === "relative") return "relative";
  return null;
}

export interface BackupController {
  readonly getState: () => BackupState;
  readonly subscribe: (listener: () => void) => () => void;
  readonly edit: (parent: string) => void;
  /** 확인 대화 상자를 연다. 막혀 있으면 열지 않고 막힌 까닭만 새로 읽는다 */
  readonly ask: () => void;
  /** 확인 대화 상자를 닫는다. 명령은 부르지 않는다 */
  readonly cancel: () => void;
  /** 확인이다. 막혀 있지 않으면 입력의 양쪽 빈칸을 뗀 경로로 `backup`을 한 번 부른다 */
  readonly confirm: () => Promise<void>;
}

export interface BackupControllerOptions {
  /** 백업이 끝나면(만들었거나 거절) 한 번 부른다. 화면은 성공 토스트를 여기서 띄운다 */
  readonly settled?: (phase: BackupPhase) => void;
}

export function createBackupController(
  port: Pick<StorageCommands, "engineTarget" | "backup">,
  options: BackupControllerOptions = {},
): BackupController {
  let state: BackupState = {
    parent: "",
    target: port.engineTarget(),
    asking: false,
    phase: { kind: "idle" },
  };
  const listeners = new Set<() => void>();
  const set = (next: BackupState): void => {
    state = next;
    for (const listener of listeners) listener();
  };
  // 엔진 대상은 화면이 열린 뒤에 바뀔 수 있으므로 판단 전에 다시 읽는다
  const refreshed = (): BackupState => ({ ...state, target: port.engineTarget() });

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    edit: (parent) => {
      set({ ...state, parent });
    },
    ask: () => {
      const next = refreshed();
      set(backupBlockOf(next) === null ? { ...next, asking: true } : next);
    },
    cancel: () => {
      set({ ...state, asking: false });
    },
    confirm: async () => {
      const next = { ...refreshed(), asking: false };
      if (backupBlockOf(next) !== null) {
        set(next);
        return;
      }
      set({ ...next, phase: { kind: "running" } });
      const result = await port.backup(next.parent.trim());
      const phase: BackupPhase = result.ok
        ? { kind: "done", report: result.value }
        : { kind: "refused", failure: result.error };
      set({ ...state, phase });
      options.settled?.(phase);
    },
  };
}

// 컨트롤러는 명령 묶음마다 하나를 앱이 사는 동안 들고 있는다. 설정 화면이 다시 마운트돼도 결과 블록(블롭 수, 만든 폴더)이 그대로 보이게 한다.
const shared = new WeakMap<object, BackupController>();

/** `port`마다 한 번만 만든 컨트롤러. 화면이 다시 마운트돼도 같은 상태를 돌려준다 */
export function sharedBackupController(
  port: Pick<StorageCommands, "engineTarget" | "backup"> & object,
  options: BackupControllerOptions = {},
): BackupController {
  const known = shared.get(port);
  if (known !== undefined) return known;
  const made = createBackupController(port, options);
  shared.set(port, made);
  return made;
}
