// 안전 모드 안내의 모양(U-06). 어느 자리를 보일지, 단추를 누를 수 있는지, 칩의 정보 글을 정한다. 그림은 `safe-mode-card.tsx`와 `safe-mode-chip.tsx`가 그린다.
import { t, type MessageId } from "@fresnel/client/i18n";
import type { EngineState } from "../transport/ipc.ts";
import type { SafeModeCause, SafeModeSnapshot } from "./commands.ts";

/** 보일 자리: 제안 카드(셸만), 안전 모드 칩(셸과 웹), 없음 */
export type SafeModeSurface = "card" | "chip" | "none";

/**
 * 안전 모드 안내의 자리. 안전 모드로 떠 있으면 칩이고(웹에도 칩은 있다), 제안이 있고 셸이면 카드다.
 * 웹에는 카드가 없다(셸이 엔진을 다시 띄울 수 없으므로 단추를 줄 수 없다).
 */
export function safeModeSurfaceOf(
  snapshot: SafeModeSnapshot | null,
  shellRestart: boolean,
): SafeModeSurface {
  if (snapshot === null) return "none";
  if (snapshot.active) return "chip";
  return snapshot.suggest && shellRestart ? "card" : "none";
}

/**
 * 안전 모드 상태를 읽을 때인지. 엔진이 running이고 연결이 열렸을 때만 읽는다. 거울은 running을 연결보다 먼저 받으므로 running만으로는 이르다.
 */
export function safeModeReadDueOf(engine: EngineState["kind"] | null, live: boolean): boolean {
  return engine === "running" && live;
}

/**
 * 안전 모드 단추를 누를 수 있는 엔진 상태. 살아 있는 엔진(running)과 실패한 엔진(failed)만 받는다.
 * 셸 `restart_manually`가 시작 중·재시작 중·멈추는 중에는 `EngineNotRunning`으로 거절한다.
 */
export function canSwitchSafeModeOf(engine: EngineState["kind"] | null): boolean {
  return engine === "running" || engine === "failed";
}

const CAUSE_TEXT: Readonly<Record<SafeModeCause, MessageId>> = {
  user: "desktop.safe.cause.user",
  startupFailures: "desktop.safe.cause.startupFailures",
  flag: "desktop.safe.cause.flag",
};

/** 칩의 정보 글: 꺼진 것과 원인. 원인이 없으면(구형 호스트) 꺼진 것만 남는다 */
export function safeModeTipOf(snapshot: SafeModeSnapshot): string {
  const off = t("desktop.safe.off");
  return snapshot.cause === null ? off : `${off}. ${t(CAUSE_TEXT[snapshot.cause])}`;
}
