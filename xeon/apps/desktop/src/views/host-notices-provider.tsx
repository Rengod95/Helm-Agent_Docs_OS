// 호스트 알림을 엔진이 running이 될 때 읽어 얹는다(`settingsProblems`). 안전 모드 읽기(`safe-mode-provider.tsx`)와 같은 시점을 쓴다:
// 엔진이 running이고 연결이 열렸을 때 읽는다. 설정 파일이 바뀌어 문제가 생기거나 풀리면 `settings.invalidated`가 와서 다시 읽는다.
// 읽기가 실패하면 값을 null로 두어 아무것도 보이지 않는다. 실패 원인은 명령이 로그로 남긴다.
import { detach, rethrow } from "@fresnel/contracts";
import { useEffect, useState, type ReactNode } from "react";
import { useEngineState, useLinkPhase } from "../state/engine/index.ts";
import { useCommands } from "./commands.ts";
import type { HostNoticesSnapshot } from "./commands.ts";
import { HostNoticesContext } from "./host-notices-context.ts";
import { safeModeReadDueOf } from "./safe-mode-model.ts";

export function HostNoticesProvider(props: { readonly children: ReactNode }): ReactNode {
  const commands = useCommands();
  const kind = useEngineState()?.kind ?? null;
  const live = useLinkPhase() === "live";
  const [snapshot, setSnapshot] = useState<HostNoticesSnapshot | null>(null);
  useEffect(() => {
    // 읽는 때의 판정은 안전 모드 읽기와 같다(엔진이 running이고 연결이 열렸을 때)
    if (!safeModeReadDueOf(kind, live)) return undefined;
    let current = true;
    const read = (): void => {
      detach(
        commands.setup.loadHostNotices().then((result) => {
          if (current) setSnapshot(result.ok ? result.value : null);
          return undefined;
        }),
        rethrow,
      );
    };
    read();
    const stop = commands.setup.onAnyInvalidated(read);
    return () => {
      current = false;
      stop();
    };
  }, [commands, kind, live]);
  return <HostNoticesContext value={snapshot}>{props.children}</HostNoticesContext>;
}
