// 안전 모드 상태를 엔진이 running이 될 때 한 번 읽어 얹는다(U-06). 폴링하지 않는다: 엔진 상태 종류나 연결 상태가 바뀔 때만 다시 읽는다.
// 엔진 거울은 running을 연결(hello)보다 먼저 받으므로, 연결이 열린 뒤(link가 live)에 읽는다. 그러지 않으면 연결 없이 읽어 실패한다.
// 읽기가 실패하면 값을 null로 두어 아무것도 보이지 않는다. 안전 모드 안내는 화면을 막는 일이 아니고, 실패 원인은 명령이 로그로 남긴다.
import { detach, rethrow } from "@fresnel/contracts";
import { useEffect, useState, type ReactNode } from "react";
import { useEngineState, useLinkPhase } from "../state/engine/index.ts";
import { useCommands } from "./commands.ts";
import type { SafeModeSnapshot } from "./commands.ts";
import { SafeModeContext } from "./safe-mode-context.ts";
import { safeModeReadDueOf } from "./safe-mode-model.ts";

export function SafeModeProvider(props: { readonly children: ReactNode }): ReactNode {
  const commands = useCommands();
  const kind = useEngineState()?.kind ?? null;
  const live = useLinkPhase() === "live";
  const [snapshot, setSnapshot] = useState<SafeModeSnapshot | null>(null);
  useEffect(() => {
    if (!safeModeReadDueOf(kind, live)) return undefined;
    let current = true;
    detach(
      commands.setup.loadSafeMode().then((result) => {
        if (current) setSnapshot(result.ok ? result.value : null);
        return undefined;
      }),
      rethrow,
    );
    return () => {
      current = false;
    };
  }, [commands, kind, live]);
  return <SafeModeContext value={snapshot}>{props.children}</SafeModeContext>;
}
