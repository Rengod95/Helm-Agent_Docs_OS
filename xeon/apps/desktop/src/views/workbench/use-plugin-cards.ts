// 크래프트 플러그인 목록과 상세가 읽는 플러그인 카드(`plugin.list`, plugTab). 카드에는 목적, 설명, 하는 일(종류), 비용, 권한,
// 그리고 엔진이 주면 도구 준비 상태(`tool-ready.ts`)가 있다. 목록(`ext.list`)이 바뀌면(설치, 지우기 승인) 다시 읽는다.
// 읽기가 실패하면 목록과 상세는 카드 없이 지금처럼 그린다(종류 칸과 목적 줄이 빈다).
import { detach, rethrow } from "@fresnel/contracts";
import type { PluginCard } from "@fresnel/contracts/extensions";
import { useCallback, useEffect, useState } from "react";
import { useWorkbench } from "../../state/workbench/index.ts";
import { useCommands } from "../commands.ts";

type PluginCardsLoad =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly byName: ReadonlyMap<string, PluginCard> };

export interface PluginCards {
  /** 이름의 카드. 읽는 중이거나 실패했거나 카드가 없으면 null */
  readonly cardOf: (name: string) => PluginCard | null;
  /** 다시 읽는다(상세의 "다시 확인") */
  readonly reload: () => void;
}

export function usePluginCards(): PluginCards {
  const commands = useCommands();
  const entries = useWorkbench((s) => s.entries);
  const [load, setLoad] = useState<PluginCardsLoad>({ kind: "loading" });
  const [round, setRound] = useState(0);
  useEffect(() => {
    let live = true;
    detach(
      commands.workbench.pluginCards().then((got) => {
        if (!live) return undefined;
        setLoad(
          got.ok
            ? {
                kind: "ready",
                byName: new Map(got.value.map((card) => [card.name, card] as const)),
              }
            : { kind: "error" },
        );
        return undefined;
      }),
      rethrow,
    );
    return () => {
      live = false;
    };
  }, [commands, entries, round]);
  const reload = useCallback(() => {
    setRound((n) => n + 1);
  }, []);
  const cardOf = useCallback(
    (name: string): PluginCard | null =>
      load.kind === "ready" ? (load.byName.get(name) ?? null) : null,
    [load],
  );
  return { cardOf, reload };
}
