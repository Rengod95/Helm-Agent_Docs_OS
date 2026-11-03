import type { ThreadId } from "@fresnel/contracts/conversation";
import { WIRE_ERRORS, type ExtListEntry, type ProfileApplyParams } from "@fresnel/contracts/wire";
import { isExemptTier, isOn, lockOf, type WorkbenchState } from "./model.ts";

// 검사 탭의 "이 대화에서" 구역(spec §6.22.4)의 순수 모델. 값과 잠금, 요청 모양, 프로필 실패 갈래만 만든다.
// 대화 범위 상태는 `ext.list`에 `threadId`를 준 행의 `registration`이고, 없으면 전역 `status`다(호스트 `ext-read-port`).
// 이 대화에서 끄기는 `settings.set`(범위 launch, threadId)이다. 면제 tier는 스위치가 없고, 전역에서 꺼진 확장은 잠근다.

/** 이 대화에서 끄기 스위치가 잠기는 이유. 잠기지 않으면 스위치는 열려 있다 */
export type ThreadLock = "no_thread" | "global_off" | "safe_mode" | "managed";

/** 스위치 그림. 면제 tier는 그리지 않는다(`hidden`). `on`은 이 대화에서 켜졌나 */
export type ThreadSwitchVM =
  | { readonly kind: "hidden" }
  | { readonly kind: "locked"; readonly lock: ThreadLock; readonly on: boolean }
  | { readonly kind: "open"; readonly on: boolean };

/** 이 대화에서의 켜짐. 대화가 덮어 쓴 상태(`registration`)가 있으면 그것, 없으면 전역 상태다 */
export function threadOnOf(entry: ExtListEntry): boolean {
  return isOn({ ...entry, status: entry.registration ?? entry.status });
}

/**
 * 다음 단계 경계를 기다리는 중이면 기다리는 켜짐 값(켜는 중 true, 끄는 중 false), 아니면 null.
 * 호스트는 대화에서 바꾼 값을 경계 전까지 `enabling`·`disabling`으로 보인다(`threadStatus`).
 */
export function threadPendingOf(entry: ExtListEntry): boolean | null {
  const status = entry.registration ?? entry.status;
  if (status === "enabling") return true;
  if (status === "disabling") return false;
  return null;
}

/**
 * 스위치의 그림. `entry`는 대화 범위로 읽은 행(없으면 전역 행)이고, `threadOpen`은 열린 대화가 있나다.
 * 잠금 순서: 대화가 없음, 안전 모드·관리 정책, 전역에서 꺼짐(크래프트에서 켜야 한다)
 */
export function threadSwitchOf(entry: ExtListEntry, threadOpen: boolean): ThreadSwitchVM {
  if (isExemptTier(entry)) return { kind: "hidden" };
  const on = threadOnOf(entry);
  if (!threadOpen) return { kind: "locked", lock: "no_thread", on };
  const lock = lockOf(entry);
  if (lock === "safe_mode" || lock === "managed") return { kind: "locked", lock, on };
  if (entry.status === "disabled") return { kind: "locked", lock: "global_off", on };
  return { kind: "open", on };
}

/** 이 대화에서 켜기·끄기 요청. 범위는 `launch`이고 대화 id를 싣는다 */
export interface ThreadToggleRequest {
  readonly key: string;
  readonly value: boolean;
  readonly scope: "launch";
  readonly threadId: ThreadId;
}

export type ThreadToggleRefusal = "unknown" | "no_thread" | "locked";

/** 이 대화에서 `target`으로 돌리는 요청. 잠긴 스위치와 대화가 없는 경우는 보내지 않는다 */
export function threadToggleRequestOf(
  s: WorkbenchState,
  name: string,
  threadId: ThreadId | null,
  target: boolean,
):
  | { readonly ok: true; readonly request: ThreadToggleRequest }
  | { readonly ok: false; readonly reason: ThreadToggleRefusal } {
  const entry = s.entries.find((e) => e.name === name);
  if (entry === undefined) return { ok: false, reason: "unknown" };
  if (threadId === null) return { ok: false, reason: "no_thread" };
  if (threadSwitchOf(entry, true).kind !== "open") return { ok: false, reason: "locked" };
  return {
    ok: true,
    request: { key: `ext.${name}.enabled`, value: target, scope: "launch", threadId },
  };
}

/** 이 대화에 프로필을 적용하는 요청. 층은 `thread`다 */
export function profileApplyRequestOf(id: string, threadId: ThreadId): ProfileApplyParams {
  return { id, threadId, layer: "thread" };
}

/** 프로필 적용 실패를 화면이 구분하는 갈래. 나머지 실패(연결, 알 수 없는 오류)는 `failed`다 */
export type ProfileFailure = "not_found" | "trust_required" | "apply_partial" | "limit" | "failed";

/** wire 오류 코드(`profile.*`)를 실패 갈래로 바꾼다. 코드가 없거나 모르면 `failed`다 */
export function profileFailureOf(code: number | null): ProfileFailure {
  if (code === WIRE_ERRORS["profile.notFound"].code) return "not_found";
  if (code === WIRE_ERRORS["profile.trustRequired"].code) return "trust_required";
  if (code === WIRE_ERRORS["profile.applyPartial"].code) return "apply_partial";
  if (code === WIRE_ERRORS["profile.limit"].code) return "limit";
  return "failed";
}
