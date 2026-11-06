// 창을 모두 닫았을 때 앱을 끝낼지(L4.desktop.spec §4.18). Tauri `effective_close_behavior`와 같은 규칙이다.
// 설정이 `tray`여도 트레이가 없으면 `quit`처럼 움직인다(창을 닫았는데 앱이 보이지 않게 남는 일을 막는다).
// 값을 쓰는 쪽: 트레이 모듈이 `setTrayActive`, 설정 모듈(ecore)이 `setConfiguredCloseBehavior`.

export type CloseBehavior = "tray" | "quit";

export function effectiveCloseBehavior(
  configured: CloseBehavior,
  trayActive: boolean,
): CloseBehavior {
  return configured === "tray" && !trayActive ? "quit" : configured;
}

/** 값 문자열을 닫기 동작으로. 모르는 값은 null(쓰지 않는다) */
export function parseCloseBehavior(value: unknown): CloseBehavior | null {
  return value === "tray" || value === "quit" ? value : null;
}

interface CloseState {
  configured: CloseBehavior;
  trayActive: boolean;
}

/** 기본값은 `tray`다 [결정: 2026-11-06 사용자, B-10 승인] */
const state: CloseState = { configured: "tray", trayActive: false };

export function setConfiguredCloseBehavior(value: CloseBehavior): void {
  state.configured = value;
}

export function setTrayActive(active: boolean): void {
  state.trayActive = active;
}

export function shouldQuitWhenWindowsClosed(): boolean {
  return effectiveCloseBehavior(state.configured, state.trayActive) === "quit";
}
