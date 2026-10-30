import { detach, rethrow } from "@xeon/contracts";
import { useEffect, useState } from "react";
import { t } from "@xeon/client/i18n";
import { readyToChat } from "@xeon/client/settings";
import { useLinkPhase } from "../state/engine/index.ts";
import { useCommands } from "./commands.ts";

/** 모델 키와 기본 모델을 정해야 대화를 시작할 수 있다는 안내. 부를 때의 로케일로 문장을 만든다 */
export function setupRequiredText(): string {
  return t("desktop.setup.required");
}

// setup-banner.tsx(.tsx라 이 단위에서 고치지 않는다)가 아직 이 상수를 읽는다. 모듈을 읽을 때의 로케일에 묶이므로,
// 그 파일이 setupRequiredText()를 부르게 되면 이 상수를 지운다.
export const SETUP_REQUIRED_TEXT: string = setupRequiredText();

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
