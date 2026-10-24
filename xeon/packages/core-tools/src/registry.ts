import { err, ok, type Result } from "@xeon/contracts";
import type { ToolName } from "@xeon/contracts/capabilities";
import type { ToolRegisterError } from "@xeon/contracts/extensions";
import type { ToolEntry } from "./types.ts";

// L1.tools.spec §3.3 등록 표. 같은 이름이 이미 있으면 등록은 통째로 실패하고 표는 그대로다(name_conflict). 확장 조합이 낼 수 있는 정상 운영 중의 실패라 값으로 돌려준다(TY-24).

export interface ToolRegistry {
  /** 등록한다. 돌려주는 함수가 이 호출로 넣은 항목을 뺀다. 이름이 겹치면 아무것도 넣지 않고 err */
  add(entries: readonly ToolEntry[]): Result<() => void, ToolRegisterError>;
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
          return err({ kind: "name_conflict", toolName: entry.name });
        }
        incoming.add(entry.name);
      }
      for (const entry of entries) table.set(entry.name, entry);
      let removed = false;
      return ok(() => {
        if (removed) return;
        removed = true;
        for (const entry of entries) {
          // 같은 이름이 다른 등록으로 바뀌어 있으면 그 항목은 건드리지 않는다
          if (table.get(entry.name) === entry) table.delete(entry.name);
        }
      });
    },
    get: (name) => table.get(name),
    all: () => [...table.values()],
  };
}
