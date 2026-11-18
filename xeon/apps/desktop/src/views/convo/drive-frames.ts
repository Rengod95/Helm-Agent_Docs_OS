import { detach, rethrow } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { DriveFrameView } from "@fresnel/contracts/extensions";
import { useEffect, useState } from "react";
import { useLinkPhase } from "../../state/engine/index.ts";
import { useCommands } from "../commands.ts";

// 대화의 Drive 스택(`drive.frames`)을 읽고 `drive.framesChanged`마다 다시 읽는다. 입력창 위 띠가 쓴다.

/** 읽기 상태. 연결이 없으면 `offline`이고 읽지 않는다 */
export type DriveFramesRead =
  | { readonly kind: "offline" }
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly frames: readonly DriveFrameView[] };

const LOADING: DriveFramesRead = { kind: "loading" };
const OFFLINE: DriveFramesRead = { kind: "offline" };

/** 대화가 바뀌면 다른 대화의 값은 읽는 중으로 보인다 */
export function useDriveFrames(threadId: ThreadId): DriveFramesRead {
  const commands = useCommands();
  const live = useLinkPhase() === "live";
  const [loaded, setLoaded] = useState<{
    readonly threadId: ThreadId;
    readonly read: DriveFramesRead;
  } | null>(null);
  useEffect(() => {
    if (!live) return undefined;
    let active = true;
    const load = async (): Promise<void> => {
      const got = await commands.workbench.driveFrames(threadId);
      if (!active) return;
      setLoaded({
        threadId,
        read: got.ok ? { kind: "ready", frames: got.value } : { kind: "error" },
      });
    };
    detach(load(), rethrow);
    const off = commands.workbench.onDriveFramesChanged(threadId, () => {
      detach(load(), rethrow);
    });
    return () => {
      active = false;
      off();
    };
  }, [commands, live, threadId]);
  if (!live) return OFFLINE;
  return loaded !== null && loaded.threadId === threadId ? loaded.read : LOADING;
}
