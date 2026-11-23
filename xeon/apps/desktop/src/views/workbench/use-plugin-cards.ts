// 크래프트 플러그인 목록과 상세가 읽는 플러그인 카드(`plugin.list`, plugTab). 카드에는 목적, 설명, 하는 일(종류), 비용, 권한,
// 도구 플러그인의 도구 칸(`externalTool`)과 의존이 있다. 준비 상태(`tool-ready.ts`)는 이 카드들에서 화면 쪽이 모은다(plugWire).
// 목록(`ext.list`)이 바뀌면(설치, 지우기 승인) 다시 읽는다. 읽기가 실패하면 목록과 상세는 카드 없이 그린다(종류 칸과 목적 줄이 빈다).
import { activeLocale } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import type { PluginCard } from "@fresnel/contracts/extensions";
import { useCallback, useEffect, useState } from "react";
import { useWorkbench } from "../../state/workbench/index.ts";
import { useCommands } from "../commands.ts";
import { toolReadinessOf, type ToolReadinessVM } from "./tool-ready.ts";

type PluginCardsLoad =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly byName: ReadonlyMap<string, PluginCard> };

export interface PluginCards {
  /** 이름의 카드. 읽는 중이거나 실패했거나 카드가 없으면 null */
  readonly cardOf: (name: string) => PluginCard | null;
  /** 이름의 준비 상태. 카드가 없거나, 도구 플러그인도 아니고 도구에 기대지도 않으면 null */
  readonly readinessOf: (name: string) => ToolReadinessVM | null;
  /** 상세의 "다시 확인": 엔진에 도구 점검을 다시 시키고 카드를 다시 읽는다. 점검 요청이 실패해도 카드는 다시 읽는다 */
  readonly recheck: () => void;
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
  const recheck = useCallback(() => {
    detach(
      commands.workbench.recheckTools().then(() => {
        setRound((n) => n + 1);
        return undefined;
      }),
      rethrow,
    );
  }, [commands]);
  const cardOf = useCallback(
    (name: string): PluginCard | null =>
      load.kind === "ready" ? (load.byName.get(name) ?? null) : null,
    [load],
  );
  const readinessOf = useCallback(
    (name: string): ToolReadinessVM | null => {
      const card = cardOf(name);
      return card === null ? null : toolReadinessOf(card, cardOf, activeLocale());
    },
    [cardOf],
  );
  return { cardOf, readinessOf, recheck };
}
