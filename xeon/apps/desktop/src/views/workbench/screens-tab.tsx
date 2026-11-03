// P-17 화면 탭(§6.24): 이 확장이 기여한 화면(자리, 모드, id, 상태, 진단 수). 읽기는 `ext.ui.list`(옛 이름 `ext.view.list`)다.
// "화면 다시 켜기"는 두지 않는다: 화면 장부(`views/ledger.ts`)의 인스턴스가 데스크톱 앱에 없어서 되돌릴 곳이 없다.
import { t, type MessageId } from "@fresnel/client/i18n";
import { screenRowsOf, type ScreenRowVM, type TabRead } from "@fresnel/client/workbench";
import { err, ok } from "@fresnel/contracts";
import { Badge, StatusDot } from "@caustic/react";
import type { ReactNode } from "react";
import { useCallback } from "react";
import { useLinkPhase } from "../../state/engine/index.ts";
import { useCommands } from "../commands.ts";
import { TabBody, MUTED } from "./tab-body.tsx";
import { tabLinkOf, useTabRead } from "./tab-read.ts";

const PLACEMENT_TEXT: Readonly<Record<ScreenRowVM["placement"], MessageId>> = {
  page: "desktop.workbench.placement.page",
  panel: "desktop.workbench.placement.panel",
  card: "desktop.workbench.placement.card",
  status: "desktop.workbench.placement.status",
  command: "desktop.workbench.placement.command",
  settings: "desktop.workbench.placement.settings",
};

const MODE_TEXT: Readonly<Record<ScreenRowVM["mode"], MessageId>> = {
  native: "desktop.workbench.uiMode.native",
  app: "desktop.workbench.uiMode.app",
};

const STATE_TEXT: Readonly<Record<ScreenRowVM["state"], MessageId>> = {
  ok: "desktop.workbench.screenState.ok",
  invalid: "desktop.workbench.screenState.invalid",
  disabled: "desktop.workbench.screenState.disabled",
};

/** 상태 점의 색. 색만으로 뜻을 전하지 않도록 글은 `STATE_TEXT`가 붙는다 */
const STATE_TONE: Readonly<Record<ScreenRowVM["state"], "success" | "danger" | "neutral">> = {
  ok: "success",
  invalid: "danger",
  disabled: "neutral",
};

/** 화면 탭의 그림: 줄 목록(또는 빈 문장)과 읽기 상태 */
export function ScreensPanel(props: { readonly read: TabRead<readonly ScreenRowVM[]> }): ReactNode {
  return (
    <TabBody
      read={props.read}
      render={(rows) =>
        rows.length === 0 ? (
          <p className={MUTED}>{t("desktop.workbench.screens.empty")}</p>
        ) : (
          <ul className="m-0 grid list-none gap-1.5 p-0 text-ui-sm">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-2 px-2">
                <span className="text-text-primary">{row.title}</span>
                <span className="font-mono text-text-tertiary">{row.id}</span>
                <Badge size="sm">{t(PLACEMENT_TEXT[row.placement])}</Badge>
                <Badge size="sm">{t(MODE_TEXT[row.mode])}</Badge>
                <StatusDot tone={STATE_TONE[row.state]} label={t(STATE_TEXT[row.state])} />
                {row.issues > 0 && (
                  <span className="ms-auto text-text-tertiary">
                    {t("desktop.workbench.screens.issues", { count: row.issues })}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )
      }
    />
  );
}

/** 화면 탭: 목록 전체를 읽고 이 확장의 화면만 남긴다. 연결과 확장 목록 알림에 따라 다시 읽는다 */
export function ScreensTab(props: { readonly name: string }): ReactNode {
  const commands = useCommands();
  const link = tabLinkOf(useLinkPhase());
  const { name } = props;
  const load = useCallback(async () => {
    const got = await commands.workbench.views();
    return got.ok ? ok(screenRowsOf(name, got.value)) : err(got.error);
  }, [commands, name]);
  const read = useTabRead(name, link, load);
  return <ScreensPanel read={read} />;
}
