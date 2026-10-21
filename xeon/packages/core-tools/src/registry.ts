import { Bug } from "@xeon/contracts";
import type { ToolName } from "@xeon/contracts/capabilities";
import type { ToolEntry } from "./types.ts";

// L1.tools.spec §3.3 등록 표. 같은 이름이 이미 있으면 등록은 통째로 실패한다(tools.name_conflict, 버그로 보고 던진다).

export interface ToolRegistry {
  /** 등록한다. 돌려주는 함수가 이 호출로 넣은 항목을 뺀다 */
  add(entries: readonly ToolEntry[]): () => void;
  get(name: ToolName): ToolEntry | undefined;
  all(): readonly ToolEntry[];
}

export function createRegistry(): ToolRegistry {
  const table = new Map<ToolName, ToolEntry>();
  return {
    add(entries) {
      const incoming = new Set<string>();
      for (const entry of entries) {
        if (table.has(entry.name) || incoming.has(entry.name)) {
          throw new Bug(`tools.name_conflict: tool "${entry.name}" is already registered`);
        }
        incoming.add(entry.name);
      }
      for (const entry of entries) table.set(entry.name, entry);
      let removed = false;
      return () => {
        if (removed) return;
        removed = true;
        for (const entry of entries) {
          // 같은 이름이 다른 등록으로 바뀌어 있으면 그 항목은 건드리지 않는다
          if (table.get(entry.name) === entry) table.delete(entry.name);
        }
      };
    },
    get: (name) => table.get(name),
    all: () => [...table.values()],
  };
}
