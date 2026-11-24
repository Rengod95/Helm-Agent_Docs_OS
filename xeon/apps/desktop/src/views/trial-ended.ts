import { detach, rethrow } from "@fresnel/contracts";
import type { ExtTestRecord } from "@fresnel/contracts/wire";
import { useEffect, useState } from "react";
import { useCommands } from "./commands.ts";
import { useLinkPhase, useOpenThread } from "../state/engine/index.ts";

// 시험 대화가 끝났는지. `ext.test.list`의 기록 상태를 쓴다(새 값을 만들지 않는다). 앱을 다시 켜면 돌던 시험 기록은 `failed`가 된다.

/** 그 대화의 시험 실행 기록이 `running`이 아니면(실패했거나 끝났으면) true. 기록이 없으면 false다 */
export function trialEndedOf(records: readonly ExtTestRecord[], threadId: string): boolean {
  const own = records.find((record) => record.kind === "testRun" && record.threadId === threadId);
  return own !== undefined && own.state !== "running";
}

/** 열린 대화가 시험 대화이고 그 시험이 끝났으면 true. 대화를 열 때와 연결이 붙을 때 읽는다 */
export function useTrialEnded(threadId: string): boolean {
  const commands = useCommands();
  const phase = useLinkPhase();
  const isTrial = useOpenThread()?.testRun !== undefined;
  const [ended, setEnded] = useState<{ readonly id: string; readonly value: boolean } | null>(null);
  useEffect(() => {
    if (!isTrial || phase !== "live") return undefined;
    let active = true;
    const run = async (): Promise<void> => {
      const got = await commands.tests.list();
      if (active && got.ok) setEnded({ id: threadId, value: trialEndedOf(got.value, threadId) });
    };
    detach(run(), rethrow);
    return () => {
      active = false;
    };
  }, [commands, isTrial, phase, threadId]);
  return isTrial && ended?.id === threadId && ended.value;
}
