import { detach, rethrow } from "@fresnel/contracts";
import { useEffect, useState } from "react";
import { trialEndedOf } from "../plugin-ui/trial-end.ts";
import { useOptionalPluginUi } from "./plugin/plugin-context.tsx";
import { useCommands } from "./commands.ts";
import { useLinkPhase, useOpenThread } from "../state/engine/index.ts";

/** 열린 대화가 시험 대화이고 그 시험이 끝났으면 true. 대화를 열 때와 연결이 붙을 때 읽는다 */
export function useTrialEnded(threadId: string): boolean {
  const commands = useCommands();
  const phase = useLinkPhase();
  const isTrial = useOpenThread()?.testRun !== undefined;
  const pluginUi = useOptionalPluginUi();
  const [ended, setEnded] = useState<{ readonly id: string; readonly value: boolean } | null>(null);
  useEffect(() => {
    if (!isTrial || phase !== "live") return undefined;
    let active = true;
    const run = async (): Promise<void> => {
      const got = await commands.tests.list();
      if (!active || !got.ok) return;
      const value = trialEndedOf(got.value, threadId);
      setEnded({ id: threadId, value });
      // 시험이 끝났으면 화면 목록을 다시 읽어, 드래프트 앱 root를 거두고 열린 프레임을 닫는다(AGE-77 Y-04). 읽기가 끝난 시험을 알아본다
      if (value && pluginUi !== null) detach(pluginUi.runtime.refresh(threadId), rethrow);
    };
    detach(run(), rethrow);
    return () => {
      active = false;
    };
  }, [commands, isTrial, phase, pluginUi, threadId]);
  return isTrial && ended?.id === threadId && ended.value;
}
