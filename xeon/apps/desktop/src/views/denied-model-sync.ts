import { useEffect, useRef } from "react";
import { useThreadSummaries, useTurnFailures } from "../state/engine/index.ts";
import { useCommands } from "./commands.ts";
import { denialStepOf, type DenialTrack } from "./denied-model-model.ts";
import { useDefaultModel } from "./model-usage.ts";

// 턴이 끝날 때마다 403으로 실패한 모델을 적고 성공한 모델의 표시를 지운다(`denied-model-model.ts`). 화면은 없다.
// 대화 목록과 실패 문장은 거울에서 읽고, 기본 모델은 설정 스냅샷에서 읽는다. 바뀔 때만 다시 본다.
export function ModelDenialSync(): null {
  const commands = useCommands();
  const threads = useThreadSummaries();
  const failures = useTurnFailures();
  const defaultModel = useDefaultModel();
  const track = useRef<DenialTrack>({});
  useEffect(() => {
    const step = denialStepOf({ track: track.current, threads, failures, defaultModel });
    track.current = step.track;
    for (const key of step.denied) commands.noteModelDenied(key);
    for (const key of step.allowed) commands.clearModelDenied(key);
  }, [commands, threads, failures, defaultModel]);
  return null;
}
