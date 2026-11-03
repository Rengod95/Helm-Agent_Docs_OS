// P-17 설정 탭(§6.24): 이 확장의 설정 줄을 읽기 전용으로 보인다. 키, 값, 범위 배지. 시크릿 값은 싣지 않는다.
// 줄은 `extSettingRowsOf`(@fresnel/client/workbench)가 만들고, 읽기는 `commands.workbench.settings`가 한다. 편집은 없다(P-09 입력 칸이 없다).
import { t } from "@fresnel/client/i18n";
import { extSettingRowsOf, type ExtSettingRowVM, type TabRead } from "@fresnel/client/workbench";
import { assertNever, err, ok } from "@fresnel/contracts";
import { useCallback, type ReactNode } from "react";
import { useLinkPhase, useOpenThreadId } from "../../state/engine/index.ts";
import { useCommands } from "../commands.ts";
import { TabBody, MUTED } from "./tab-body.tsx";
import { tabLinkOf, useTabRead } from "./tab-read.ts";
import { ScopeBadge } from "./source-badge.tsx";

function valueText(value: ExtSettingRowVM["value"]): string {
  switch (value.kind) {
    case "text":
      return value.text;
    case "secret":
      return t("desktop.workbench.detail.settings.secret");
    case "unset":
      return t("desktop.workbench.detail.settings.unset");
    default:
      return assertNever(value, "ExtSettingValueVM");
  }
}

/** 설정 탭의 그림. 줄 목록(또는 빈 문장)과 읽기 상태를 받는다 */
export function SettingsPanel(props: {
  readonly read: TabRead<readonly ExtSettingRowVM[]>;
}): ReactNode {
  return (
    <TabBody
      read={props.read}
      render={(rows) =>
        rows.length === 0 ? (
          <p className={MUTED}>{t("desktop.workbench.detail.settings.empty")}</p>
        ) : (
          <ul className="m-0 grid list-none gap-1.5 p-0 text-ui-sm">
            {rows.map((row) => (
              <li key={row.key} className="flex flex-wrap items-center gap-2 px-2">
                <span className="font-mono text-text-tertiary">{row.key}</span>
                <span className="text-text-primary">{row.label}</span>
                <span className="ms-auto text-text-secondary">{valueText(row.value)}</span>
                <ScopeBadge scope={row.scope} />
              </li>
            ))}
          </ul>
        )
      }
    />
  );
}

/** 설정 탭: 확장 이름과 연결을 받아 읽고 그린다. 대화가 열려 있으면 그 대화에서의 값이다 */
export function SettingsTab(props: { readonly name: string }): ReactNode {
  const commands = useCommands();
  const threadId = useOpenThreadId();
  const link = tabLinkOf(useLinkPhase());
  const { name } = props;
  const load = useCallback(async () => {
    const got = await commands.workbench.settings(name, threadId ?? undefined);
    return got.ok
      ? ok(
          extSettingRowsOf(name, {
            defs: got.value.defs,
            values: got.value.values,
            hasThread: threadId !== null,
          }),
        )
      : err(got.error);
  }, [commands, name, threadId]);
  const read = useTabRead(`${name}\u0000${threadId ?? ""}`, link, load);
  return <SettingsPanel read={read} />;
}
