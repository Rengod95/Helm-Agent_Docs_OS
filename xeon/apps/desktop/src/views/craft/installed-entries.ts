// 설치 목록(`ext.list`, 크래프트 상태의 `entries`)을 이름 보이기에만 읽는다(m6Mb, AGE-33).
// 크래프트 상태가 없는 화면(대화 화면 시험, 따로 그린 부품)에서도 깨지지 않게, 상태가 없으면 빈 목록이다: 이름은 그대로 보인다.
// 플러그인 화면을 거치지 않고 리뷰나 대화 화면을 먼저 열면 목록이 아직 읽히지 않았으므로(`list: "idle"`), 명령이 있으면 한 번 읽어 둔다.
import { detach, rethrow } from "@fresnel/contracts";
import type { ExtListEntry } from "@fresnel/contracts/wire";
import { useContext, useEffect } from "react";
import {
  createWorkbenchStore,
  useWorkbenchOf,
  useWorkbenchStoreOr,
  type WorkbenchStore,
} from "../../state/workbench/index.ts";
import { CommandsContext } from "../commands.ts";

let fallback: WorkbenchStore | null = null;

function fallbackStore(): WorkbenchStore {
  fallback ??= createWorkbenchStore();
  return fallback;
}

export function useInstalledEntries(): readonly ExtListEntry[] {
  const store = useWorkbenchStoreOr(fallbackStore);
  const commands = useContext(CommandsContext);
  const idle = useWorkbenchOf(store, (s) => s.list === "idle");
  useEffect(() => {
    if (!idle || commands === null) return;
    store.actions.listLoading();
    const load = async (): Promise<void> => {
      const listed = await commands.workbench.list();
      if (listed.ok) store.actions.listLoaded(listed.value);
      else store.actions.listFailed();
    };
    detach(load(), rethrow);
  }, [commands, idle, store]);
  return useWorkbenchOf(store, (s) => s.entries);
}
