import type { WireHandlers } from "@fresnel/contracts/wire";
import { notImplemented } from "../not-implemented.ts";

// 프로필·Test run·Trace wire. 처리기는 T-WB가 채운다(`spec-deltas/t-wb.md`).
// T-F가 `notImplemented`로 채워 둔 기본 처리기다(`spec-deltas/t-f.md` §5). 소유 트랙(T-WB)이 이 파일과
// `assembly/m4/profile-test-run-port.ts`만 고쳐서 채운다. `handlers/index.ts`, `types.ts`, `assemble.ts`, `assembly/m4/index.ts`는 고치지 않는다.

/** 처리기가 쓰는 포트. 처음에는 메서드가 없다. T-WB가 메서드를 더한다 */
export type ProfileTestRunPort = Readonly<Record<string, never>>;

export type ProfileTestRunMethods =
  | "profile.list"
  | "profile.get"
  | "profile.put"
  | "profile.delete"
  | "profile.apply"
  | "profile.preview"
  | "trace.turn"
  | "testRun.pause"
  | "testRun.resume"
  | "testRun.step"
  | "testRun.phase";

export function createProfileTestRunHandlers(
  _port: ProfileTestRunPort,
): Pick<WireHandlers, ProfileTestRunMethods> {
  return {
    "profile.list": notImplemented("profile.list"),
    "profile.get": notImplemented("profile.get"),
    "profile.put": notImplemented("profile.put"),
    "profile.delete": notImplemented("profile.delete"),
    "profile.apply": notImplemented("profile.apply"),
    "profile.preview": notImplemented("profile.preview"),
    "trace.turn": notImplemented("trace.turn"),
    "testRun.pause": notImplemented("testRun.pause"),
    "testRun.resume": notImplemented("testRun.resume"),
    "testRun.step": notImplemented("testRun.step"),
    "testRun.phase": notImplemented("testRun.phase"),
  };
}
