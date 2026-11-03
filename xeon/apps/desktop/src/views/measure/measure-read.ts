// 측정 읽기 훅. 연결이 살아 있을 때 읽고, 키가 바뀌면 이전 결과는 버린다. 그림의 상태는 `tabReadOf`가 정한다.
import {
  slotOf,
  tabReadOf,
  type TabLink,
  type TabRead,
  type TabSlot,
} from "@fresnel/client/workbench";
import { detach, rethrow, type Result } from "@fresnel/contracts";
import { useEffect, useState } from "react";
import { useCommands, type CommandError } from "../commands.ts";

export function useMeasureRead<T>(
  key: string,
  link: TabLink,
  load: (commands: ReturnType<typeof useCommands>) => Promise<Result<T, CommandError>>,
): TabRead<T> {
  const commands = useCommands();
  const [slot, setSlot] = useState<TabSlot<T> | null>(null);
  useEffect(() => {
    if (link !== "live") return undefined;
    let active = true;
    const run = async (): Promise<void> => {
      const result = await load(commands);
      if (active) setSlot(slotOf(key, result));
    };
    detach(run(), rethrow);
    return () => {
      active = false;
    };
    // `load`는 `key`가 정한다(호출자가 같은 키에 같은 읽기를 준다)
  }, [commands, key, link]);
  return tabReadOf(slot, key, link);
}
