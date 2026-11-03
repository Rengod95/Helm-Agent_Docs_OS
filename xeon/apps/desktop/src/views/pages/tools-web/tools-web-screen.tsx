import { t } from "@fresnel/client/i18n";
import { orderUpdateOf, type OrderUpdate } from "@fresnel/client";
import { detach, rethrow } from "@fresnel/contracts";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useCommands } from "../../commands.ts";
import { visibleWebViewOf } from "./tools-web-model.ts";
import { orderErrorIdOf } from "./tools-web-text.ts";
import { ToolsWebPanelView, type WebLoad } from "./tools-web-view.tsx";

// 도구와 웹 화면(P-12)의 동작. `web.providers`는 읽고(`useToolsWebState`), 검색 순서는 `orderUpdateOf`로 검사한 뒤
// `commands.web.setOrder`(`settings.set` 한 번)로 쓴다. 쓴 뒤에는 다시 읽어 고정과 현재 표시를 맞춘다.
// 그림은 `tools-web-view.tsx`가 그린다. SearXNG는 `visibleWebViewOf`가 뺀다.

export interface ToolsWebState {
  readonly load: WebLoad;
  readonly reload: () => void;
}

/** 도구와 웹 값을 읽는다. 연결이 살아 있을 때 한 번 읽고, 다시 읽기는 `reload`다. 옛 응답은 버린다 */
export function useToolsWebState(live: boolean): ToolsWebState {
  const commands = useCommands();
  const [load, setLoad] = useState<WebLoad>({ status: "loading" });
  const latest = useRef(0);
  const read = useCallback(async (): Promise<void> => {
    latest.current += 1;
    const seq = latest.current;
    const result = await commands.web.providers();
    if (seq !== latest.current) return;
    setLoad(
      result.ok
        ? { status: "ready", view: visibleWebViewOf(result.value) }
        : { status: "failed", message: t("desktop.tools.load.failed") },
    );
  }, [commands]);
  useEffect(() => {
    if (live) detach(read(), rethrow);
  }, [live, read]);
  return {
    load,
    reload: () => {
      detach(read(), rethrow);
    },
  };
}

/** 도구와 웹 탭의 패널. 검색 순서를 바꾸면 저장하고 다시 읽는다 */
export function ToolsWebPanel(props: {
  readonly state: ToolsWebState;
  readonly live: boolean;
}): ReactNode {
  const { state, live } = props;
  const commands = useCommands();
  const [saveError, setSaveError] = useState<string | null>(null);

  const save = async (update: OrderUpdate): Promise<void> => {
    const written = await commands.web.setOrder(update);
    if (!written.ok) {
      setSaveError(t("desktop.tools.order.saveFailed"));
      return;
    }
    setSaveError(null);
    state.reload();
  };

  const onMove = (order: readonly string[]): void => {
    if (state.load.status !== "ready") return;
    const update = orderUpdateOf("web.search", order, state.load.view);
    if (!update.ok) {
      setSaveError(t(orderErrorIdOf(update.error)));
      return;
    }
    detach(save(update.value), rethrow);
  };

  return (
    <ToolsWebPanelView
      load={state.load}
      offline={!live}
      saveError={saveError}
      onMove={onMove}
      onRetry={state.reload}
    />
  );
}
