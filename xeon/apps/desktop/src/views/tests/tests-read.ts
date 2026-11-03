// 테스트 화면의 목록 읽기(`ext.test.list`). 연결이 살아 있을 때 읽고, 시험을 돌린 뒤에는 `reload`로 다시 읽는다.
// 그림의 상태(읽는 중·마지막 값·오프라인·오류)는 `tabReadOf`가 정한다. 목록에는 알림이 없어 다시 읽는 때는 호출자가 정한다.
import {
  slotOf,
  tabReadOf,
  type TabLink,
  type TabRead,
  type TabSlot,
} from "@fresnel/client/workbench";
import { detach, rethrow } from "@fresnel/contracts";
import type { ExtTestRecord } from "@fresnel/contracts/wire";
import { useCallback, useEffect, useState } from "react";
import { useCommands } from "../commands.ts";

const LIST_KEY = "tests";

export interface TestListRead {
  readonly read: TabRead<readonly ExtTestRecord[]>;
  readonly reload: () => void;
}

export function useTestList(link: TabLink): TestListRead {
  const commands = useCommands();
  const [version, setVersion] = useState(0);
  const [slot, setSlot] = useState<TabSlot<readonly ExtTestRecord[]> | null>(null);
  useEffect(() => {
    if (link !== "live") return undefined;
    let active = true;
    const run = async (): Promise<void> => {
      const got = await commands.tests.list();
      if (active) setSlot(slotOf(LIST_KEY, got));
    };
    detach(run(), rethrow);
    return () => {
      active = false;
    };
  }, [commands, link, version]);
  const reload = useCallback(() => {
    setVersion((current) => current + 1);
  }, []);
  return { read: tabReadOf(slot, LIST_KEY, link), reload };
}
