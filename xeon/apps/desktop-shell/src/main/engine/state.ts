// 엔진 상태, 대상, 명령 오류 코드(L4.desktop.spec 3.3, 4.5). JSON 모양은 Rust `engine.rs`·`relay.rs`의 serde 출력과
// UI 쪽 `apps/desktop/src/transport/ipc.ts`의 EngineStateSchema와 같아야 한다.
import { ShellError } from "../commands.ts";

/** 엔진 공급원. `service`는 M3 서비스 모드 자리다(UI 스키마가 받으므로 타입에 둔다) */
type EngineSource = "sidecar" | "service";

/** 엔진이 끝난 기록. 신호로 끝나면 `code`가 null, Windows에서는 `signal`이 항상 null이다 */
export interface EngineExit {
  readonly code: number | null;
  readonly signal: number | null;
  /** RFC 3339 UTC 시각 */
  readonly at: string;
}

/** 페이지에 보이는 엔진 상태. `kind`로 나뉜다 */
export type EngineState =
  | { readonly kind: "starting"; readonly source: EngineSource; readonly attempt: number }
  | { readonly kind: "running"; readonly source: EngineSource; readonly pid: number | null }
  | {
      readonly kind: "restarting";
      readonly attempt: number;
      readonly retryAt: string;
      readonly lastExit: EngineExit;
    }
  | { readonly kind: "stopping" }
  | { readonly kind: "failed"; readonly attempts: number; readonly lastExit: EngineExit }
  | { readonly kind: "stopped" };

/** 엔진이 붙을 대상(W-08). `local`은 이 컴퓨터의 사이드카, `remote`는 주소를 붙여 띄운 엔진이다 */
export type EngineTarget =
  | { readonly kind: "local" }
  | { readonly kind: "remote"; readonly address: string };

/**
 * WebView로 돌려주는 명령 오류 코드. 문자열 그대로 거절 값이 된다(Rust의 kebab-case 직렬화와 같다).
 * - `epoch-stale`: 세대가 현재 연결과 다르다. 이전 페이지의 늦은 호출이 새 연결에 섞이지 않게 거부한다.
 * - `not-confirmed`: 살아 있는 엔진을 확인 없이 다시 띄우려 했다.
 * - `storage-failed`: 설정 파일을 읽거나 쓰지 못했다. 틀린 파일은 덮어쓰지 않으려고 이 코드를 돌려준다.
 * - `remote-target`: 원격 대상에서 데이터베이스 복원을 불렀다.
 * - `busy`: 다른 데이터베이스 복원이 이미 돌고 있다.
 */
export type CommandError =
  | "epoch-stale"
  | "engine-not-running"
  | "engine-stopping"
  | "not-confirmed"
  | "too-large"
  | "bad-request"
  | "storage-failed"
  | "remote-target"
  | "busy";

/** 명령을 거절한다. 던진 `ShellError`의 payload가 renderer의 거절 값이 된다 */
export function fail(code: CommandError): never {
  throw new ShellError(code);
}
