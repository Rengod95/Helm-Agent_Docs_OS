import { detach, rethrow } from "@xeon/contracts";
import { useEffect, useState } from "react";
import { readyToChat } from "@xeon/client/settings";
import { useLinkPhase } from "../state/engine/index.ts";
import { useCommands } from "./commands.ts";

export const SETUP_REQUIRED_TEXT = "모델 키와 기본 모델을 먼저 정해야 대화를 시작할 수 있습니다.";

/** 모델 키와 기본 모델이 끝나지 않았는가. 안내 띠와 입력창이 같은 판단을 쓴다. 설정을 읽지 못하면 거짓이다 */
export function useSetupNeeded(): boolean {
  const commands = useCommands();
  const phase = useLinkPhase();
  const [needed, setNeeded] = useState(false);

  useEffect(() => {
    if (phase !== "live") return undefined;
    let stale = false;
    const check = (): void => {
      detach(
        commands.setup.load({ binaries: false }).then((result) => {
          if (!stale) setNeeded(result.ok && !readyToChat(result.value));
          return undefined;
        }),
        rethrow,
      );
    };
    check();
    const stop = commands.setup.onInvalidated(check);
    return () => {
      stale = true;
      stop();
    };
  }, [commands, phase]);

  return needed;
}
