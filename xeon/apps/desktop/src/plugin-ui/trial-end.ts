import type { ExtTestRecord } from "@fresnel/contracts/wire";

// 시험 대화가 끝났는지. `ext.test.list`의 기록 상태를 쓴다(새 값을 만들지 않는다). 앱을 다시 켜면 돌던 시험 기록은 `failed`가 된다.

/** 그 대화의 시험 실행 기록이 `running`이 아니면(실패했거나 끝났으면) true. 기록이 없으면 false다 */
export function trialEndedOf(records: readonly ExtTestRecord[], threadId: string): boolean {
  const own = records.find((record) => record.kind === "testRun" && record.threadId === threadId);
  return own !== undefined && own.state !== "running";
}
