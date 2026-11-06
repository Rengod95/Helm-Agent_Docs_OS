// P-17 화면 탭(§6.24, wb-opus 화면 탭): 이 확장이 기여한 화면을 선 없는 표로 보인다(자리, id, 화면 방식, 상태 점, 진단 수). 읽기는 `ext.ui.list`(옛 이름 `ext.view.list`)다.
// "화면 다시 켜기"는 두지 않는다: 화면 장부(`views/ledger.ts`)의 인스턴스가 데스크톱 앱에 없어서 되돌릴 곳이 없다.
import { t, type MessageId } from "@fresnel/client/i18n";
import { screenRowsOf, type ScreenRowVM, type TabRead } from "@fresnel/client/workbench";
import { assertNever, err, ok } from "@fresnel/contracts";
import { StatusDot, Table, type TableColumn } from "@caustic/react";
import type { ReactNode } from "react";
import { useCallback } from "react";
import { useLinkPhase } from "../../state/engine/index.ts";
import { useCommands } from "../commands.ts";
import { PLAIN_TABLE, TabBody, MUTED } from "./tab-body.tsx";
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

/** 화면 표의 열. 머리글은 그릴 때 고른다(말투가 연결 뒤에 바뀔 수 있다) */
function screenColumns(): TableColumn[] {
  return [
    { key: "placement", header: t("desktop.workbench.screens.col.placement") },
    { key: "id", header: "id" },
    { key: "title", header: t("desktop.workbench.screens.col.title") },
    { key: "mode", header: t("desktop.workbench.screens.col.mode") },
    { key: "state", header: t("desktop.workbench.screens.col.state") },
    { key: "issues", header: t("desktop.workbench.screens.col.issues"), align: "end" },
  ];
}

/** 화면 표의 열 이름 */
type ScreenColumn = "placement" | "id" | "title" | "mode" | "state" | "issues";

const SCREEN_COLUMNS: readonly ScreenColumn[] = [
  "placement",
  "id",
  "title",
  "mode",
  "state",
  "issues",
];

/** 표 열의 키(문자열)를 열 이름으로 바꾼다. 열 이름이 아니면 undefined */
function screenColumnOf(key: string): ScreenColumn | undefined {
  return SCREEN_COLUMNS.find((column) => column === key);
}

/** 표 한 칸의 내용. 진단이 없으면 "—"다 */
function screenCell(row: ScreenRowVM, column: ScreenColumn): ReactNode {
  switch (column) {
    case "placement":
      return <span className="text-text-primary">{t(PLACEMENT_TEXT[row.placement])}</span>;
    case "id":
      return <span className="font-mono text-mono-sm text-text-tertiary">{row.id}</span>;
    case "title":
      return <span className="text-text-primary">{row.title}</span>;
    case "mode":
      return <span className="text-text-secondary">{t(MODE_TEXT[row.mode])}</span>;
    case "state":
      return <StatusDot tone={STATE_TONE[row.state]} label={t(STATE_TEXT[row.state])} />;
    case "issues":
      return row.issues > 0 ? (
        <span className="text-text-secondary">
          {t("desktop.workbench.screens.issues", { count: row.issues })}
        </span>
      ) : (
        <span className="text-text-tertiary">—</span>
      );
    default:
      return assertNever(column, "screenCell");
  }
}

/** 화면 탭의 그림: 표(또는 빈 문장)와 읽기 상태 */
export function ScreensPanel(props: { readonly read: TabRead<readonly ScreenRowVM[]> }): ReactNode {
  return (
    <TabBody
      read={props.read}
      render={(rows) =>
        rows.length === 0 ? (
          <p className={MUTED}>{t("desktop.workbench.screens.empty")}</p>
        ) : (
          <Table
            variant="ghost"
            size="xs"
            aria-label={t("desktop.workbench.detail.tab.screens")}
            className={PLAIN_TABLE}
            columns={screenColumns()}
            rows={rows.map((_, index) => ({ id: String(index) }))}
            renderCell={(picked, column) => {
              const row = rows[Number(picked.id)];
              const name = screenColumnOf(column.key);
              if (row === undefined || name === undefined) return null;
              return screenCell(row, name);
            }}
          />
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
