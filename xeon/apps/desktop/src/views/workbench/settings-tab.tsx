// P-17 설정 탭(§6.24, c02 설정 탭 시안): 이 확장의 설정 줄을 읽기 전용으로 보인다. 줄마다 이름, 키(mono), 범위 배지, 값, 그리고 "값 출처 · <범위> 범위가 이김 · 경로".
// 확장이 설정 화면을 그렸으면(settings slot) 줄 아래에 연한 머리 "확장이 그린 부분 · 읽기 전용"과 그 화면을 붙인다(ADR-0021 §3.2, 입력 칸은 없다).
// 줄은 `extSettingRowsOf`(@fresnel/client/workbench)가 만들고, 읽기는 `commands.workbench.settings`가 한다. 경로는 같은 읽기의 출처에서 가져온다. 시크릿 값은 싣지 않는다. 편집은 없다.
import { t } from "@fresnel/client/i18n";
import { extSettingRowsOf, type ExtSettingRowVM, type TabRead } from "@fresnel/client/workbench";
import { assertNever, err, ok } from "@fresnel/contracts";
import { useCallback, useId, type ReactNode } from "react";
import { nativeEntriesOf } from "../../plugin-ui/placements.ts";
import { useLinkPhase, useOpenThreadId } from "../../state/engine/index.ts";
import { useCommands } from "../commands.ts";
import { EntrySurface } from "../plugin/plugin-view.tsx";
import { usePluginUiState } from "../plugin/plugin-context.tsx";
import { TabBody, MUTED } from "./tab-body.tsx";
import { tabLinkOf, useTabRead } from "./tab-read.ts";
import { ScopeBadge, scopeText } from "./source-badge.tsx";

/** 설정 줄 하나: 값 줄과, 값을 정한 파일 경로(범위가 기본값이면 없다) */
type SettingLine = ExtSettingRowVM & { readonly path?: string | undefined };

/** 줄에 경로를 붙인다. 경로가 없으면(기본값) 줄을 그대로 쓴다 */
function withPath(row: ExtSettingRowVM, paths: ReadonlyMap<string, string>): SettingLine {
  const path = paths.get(row.key);
  return path === undefined ? row : { ...row, path };
}

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

/** 설정 줄 하나(c02 `SettingRow`의 읽기 전용 형태): 이름과 범위 배지, 키, 값, 값 출처 줄. 컨트롤은 없다 */
function SettingLineRow(props: { readonly line: SettingLine }): ReactNode {
  const { line } = props;
  const labelId = useId();
  return (
    <div
      role="group"
      data-slot="setting-row"
      aria-labelledby={labelId}
      className="grid gap-1.5 py-3"
    >
      <div className="flex min-w-0 flex-wrap items-baseline gap-2">
        <span id={labelId} className="text-ui font-medium text-text-primary">
          {line.label}
        </span>
        <span className="min-w-0 truncate font-mono text-mono-sm text-text-tertiary">
          {line.key}
        </span>
        <ScopeBadge scope={line.scope} />
      </div>
      <p data-slot="setting-value" className="m-0 text-ui-dense text-text-primary">
        {valueText(line.value)}
      </p>
      <p className="m-0 flex min-w-0 flex-wrap items-baseline gap-x-2 text-ui-sm text-text-tertiary">
        <span className="flex-none">{t("desktop.workbench.detail.settings.source")}</span>
        <span className="flex-none text-text-secondary">
          {t("desktop.workbench.detail.settings.wins", { scope: scopeText(line.scope) })}
        </span>
        {line.path !== undefined && (
          <span className="min-w-0 truncate font-mono text-mono-sm">{line.path}</span>
        )}
      </p>
    </div>
  );
}

/** 설정 탭의 그림. 줄 목록(또는 빈 문장)과 읽기 상태를 받는다. 확장이 설정 화면을 그렸으면(`hasSlot`) 빈 문장은 두지 않는다 */
export function SettingsPanel(props: {
  readonly read: TabRead<readonly SettingLine[]>;
  readonly hasSlot?: boolean | undefined;
}): ReactNode {
  return (
    <TabBody
      read={props.read}
      render={(rows) => {
        if (rows.length === 0) {
          return props.hasSlot === true ? null : (
            <p className={MUTED}>{t("desktop.workbench.detail.settings.empty")}</p>
          );
        }
        return (
          <div className="grid max-w-176 gap-1">
            {rows.map((line) => (
              <SettingLineRow key={line.key} line={line} />
            ))}
          </div>
        );
      }}
    />
  );
}

/**
 * 설정 화면 자리(settings slot): 확장이 설정 화면을 하나 냈으면 줄 아래에 연한 머리와 그 화면을 읽기 전용으로 붙인다.
 * 머리는 화면 제목 뒤에 "확장이 그린 부분 · 읽기 전용"을 잇는다. 입력은 위 줄의 범위 값뿐이다.
 */
function SettingsSlot(props: {
  readonly entry: { readonly title: string; readonly extension: string };
  readonly children: ReactNode;
}): ReactNode {
  return (
    <section aria-label={props.entry.title} className="grid gap-1 pt-3">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <h4 className="m-0 min-w-0 truncate text-ui-dense font-semibold text-text-primary">
          {props.entry.title}
        </h4>
        <span className="text-ui-xs text-text-tertiary">
          {`${t("desktop.workbench.detail.settings.slot")} · ${t("desktop.workbench.detail.settings.readOnly")}`}
        </span>
      </div>
      {props.children}
    </section>
  );
}

/** 설정 탭: 확장 이름과 연결을 받아 읽고 그린다. 대화가 열려 있으면 그 대화에서의 값이다 */
export function SettingsTab(props: { readonly name: string }): ReactNode {
  const commands = useCommands();
  const threadId = useOpenThreadId();
  const link = tabLinkOf(useLinkPhase());
  const plugin = usePluginUiState();
  const { name } = props;
  const slot = nativeEntriesOf(plugin.groups.settings, plugin.inactive).find(
    (entry) => entry.extension === name,
  );
  const load = useCallback(async () => {
    const got = await commands.workbench.settings(name, threadId ?? undefined);
    if (!got.ok) return err(got.error);
    const paths = new Map<string, string>();
    for (const setting of got.value.values) {
      if (setting.source.path !== undefined) paths.set(setting.key, setting.source.path);
    }
    const rows = extSettingRowsOf(name, {
      defs: got.value.defs,
      values: got.value.values,
      hasThread: threadId !== null,
    });
    return ok(rows.map((row) => withPath(row, paths)));
  }, [commands, name, threadId]);
  const read = useTabRead(`${name}\u0000${threadId ?? ""}`, link, load);
  return (
    <div className="grid gap-2">
      <SettingsPanel read={read} hasSlot={slot !== undefined} />
      {slot !== undefined && (
        <SettingsSlot entry={slot}>
          <EntrySurface entry={slot} />
        </SettingsSlot>
      )}
    </div>
  );
}
