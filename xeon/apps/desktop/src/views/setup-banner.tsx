import { detach, rethrow } from "@xeon/contracts";
import { useEffect, useState, type ReactNode } from "react";
import { readyToChat } from "../settings/index.ts";
import { useLinkPhase } from "../state/engine/index.ts";
import { useCommands } from "./commands.ts";

// 첫 실행 안내 띠(G2-08). 모델 키와 기본 모델이 끝나지 않았으면 대화 화면 위에서 설정 화면을 연다.
// 설정을 읽지 못하는 연결(오래된 엔진 등)에서는 아무것도 그리지 않는다.

export function SetupBanner(): ReactNode {
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

  if (!needed) return null;
  return (
    <div className="setup-banner" role="status">
      <span>모델 키와 기본 모델을 먼저 정해야 대화를 시작할 수 있습니다.</span>{" "}
      <button
        type="button"
        className="primary"
        onClick={() => {
          commands.showScreen("settings");
        }}
      >
        설정 열기
      </button>
    </div>
  );
}
