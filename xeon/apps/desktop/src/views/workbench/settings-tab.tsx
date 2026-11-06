// P-17 설정 탭(§6.24, c02 설정 탭 시안): 이 확장의 설정 줄을 읽기 전용으로 보인다. 줄마다 이름과 범위 배지, 오른쪽에 적용 시점, 그 아래 값, 그리고 "값 출처 · <범위> 범위가 이김 · 경로"와 가려진 범위 목록.
// 확장이 설정 화면을 그렸으면(settings slot) 줄 아래에 연한 머리 "확장이 그린 부분 · 읽기 전용"과 그 화면을 붙인다(ADR-0021 §3.2, 입력 칸은 없다).
// 줄은 `extSettingRowsOf`(@fresnel/client/workbench)가 만들고, 읽기는 `commands.workbench.settings`가 한다. 경로·적용 시점·가려진 범위는 같은 읽기의 설정 값에서 가져온다. 시크릿 값은 싣지 않는다. 편집은 없다.
import { t, type MessageId } from "@fresnel/client/i18n";
import {
  extSettingRowsOf,
  settingScopeOf,
  type ExtSettingRowVM,
  type SourceScope,
  type TabRead,
} from "@fresnel/client/workbench";
import { assertNever, err, ok } from "@fresnel/contracts";
import type { EffectiveSetting, RuntimeChange } from "@fresnel/contracts/settings";
import { Badge } from "@caustic/react";
import { ChevronRight } from "@caustic/react/icons";
import { useCallback, useId, useState, type ReactNode } from "react";
import { nativeEntriesOf } from "../../plugin-ui/placements.ts";
import { useLinkPhase, useOpenThreadId } from "../../state/engine/index.ts";
import { useCommands } from "../commands.ts";
import { EntrySurface } from "../plugin/plugin-view.tsx";
import { usePluginUiState } from "../plugin/plugin-context.tsx";
import { TONE_CLASS } from "../pages/settings/settings-text.ts";
import { TabBody, MUTED } from "./tab-body.tsx";
import { tabLinkOf, useTabRead } from "./tab-read.ts";
import { ScopeBadge, scopeText } from "./source-badge.tsx";

/** 설정 줄 하나: 값 줄과, 그 값을 정한 엔진 설정 값(경로, 적용 시점, 가려진 범위). 읽기에 그 키가 없으면 비운다 */
type SettingLine = ExtSettingRowVM & { readonly setting?: EffectiveSetting | undefined };

/** 줄에 엔진 설정 값을 붙인다. 읽기에 그 키가 없으면 줄을 그대로 쓴다 */
function withSetting(
  row: ExtSettingRowVM,
  settings: ReadonlyMap<string, EffectiveSetting>,
): SettingLine {
  const setting = settings.get(row.key);
  return setting === undefined ? row : { ...row, setting };
}

/** 적용 시점의 글(c02 `ApplyMark`의 자리). 낭독기에는 줄 이름 뒤에 읽힌다 */
const RUNTIME_TEXT: Readonly<Record<RuntimeChange, MessageId>> = {
  live: "client.settings.runtime.live",
  nextTurn: "client.settings.runtime.nextTurn",
  restart: "client.settings.runtime.restart",
};

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

/** 적용 시점 자리(c02 `ApplyMark`): 즉시는 아무것도 그리지 않고, 다음 턴은 연한 글, 재시작은 warning 배지다 */
function ApplyMark(props: { readonly change: RuntimeChange }): ReactNode {
  switch (props.change) {
    case "live":
      return null;
    case "nextTurn":
      return <span className="text-ui-sm text-text-tertiary">{t(RUNTIME_TEXT.nextTurn)}</span>;
    case "restart":
      return (
        <Badge size="sm" className={TONE_CLASS.warning}>
          {t(RUNTIME_TEXT.restart)}
        </Badge>
      );
    default:
      return assertNever(props.change, "RuntimeChange");
  }
}

/** 가려진 범위 하나. 값은 읽기에 없어서 범위와 파일 경로만 싣는다 */
interface ShadowedRow {
  readonly scope: SourceScope;
  readonly path: string | undefined;
}

/**
 * 가려진 범위 목록(c02 `ShadowedScopes`의 읽기 전용 형태): 접힌 한 줄을 펼치면 범위별 줄이 보인다.
 * 대화에서 정한 값이면 펼쳐 둔다(시안과 같다). 값을 지우는 단추는 읽기 전용이라 두지 않는다.
 */
function ShadowedList(props: {
  readonly rows: readonly ShadowedRow[];
  readonly defaultOpen: boolean;
}): ReactNode {
  const [open, setOpen] = useState(props.defaultOpen);
  return (
    <div className="grid gap-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="inline-flex w-fit items-center gap-1 rounded-sm text-ui-sm text-text-tertiary outline-none hover:text-text-primary focus-visible:focus-ring"
      >
        <ChevronRight
          aria-hidden
          className={`size-icon-xs transition-transform duration-quick ${open ? "rotate-90" : ""}`}
        />
        {t("desktop.workbench.detail.settings.shadowed")}
      </button>
      {open && (
        <div className="grid gap-1 ps-4">
          {props.rows.map((row) => (
            <div key={row.scope} className="flex min-w-0 items-center gap-2 text-ui-sm">
              <span className="w-14 flex-none text-text-tertiary">{scopeText(row.scope)}</span>
              {row.path !== undefined && (
                <span className="min-w-0 truncate font-mono text-mono-sm text-text-primary">
                  {row.path}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 설정 줄 하나(c02 `SettingRow`의 읽기 전용 형태): 이름과 범위 배지, 오른쪽의 적용 시점, 값, 값 출처 줄과 가려진 범위. 컨트롤은 없다 */
function SettingLineRow(props: { readonly line: SettingLine }): ReactNode {
  const { line } = props;
  const labelId = useId();
  const change = line.setting?.runtimeChange;
  const path = line.setting?.source.path;
  const shadowed = (line.setting?.shadowed ?? []).map((source): ShadowedRow => ({
    scope: settingScopeOf(source.scope),
    path: source.path,
  }));
  return (
    <div
      role="group"
      data-slot="setting-row"
      aria-labelledby={labelId}
      className="grid gap-1.5 py-3"
    >
      <div className="flex min-h-6 min-w-0 items-center gap-2">
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <span id={labelId} className="shrink-0 text-ui font-medium text-text-primary">
            {line.label}
            {change !== undefined && (
              <span className="sr-only">{`, ${t(RUNTIME_TEXT[change])}`}</span>
            )}
          </span>
          <ScopeBadge scope={line.scope} />
        </div>
        <div aria-hidden className="flex flex-none items-center gap-2">
          {change !== undefined && <ApplyMark change={change} />}
        </div>
      </div>
      <p data-slot="setting-value" className="m-0 text-ui-dense text-text-primary">
        {valueText(line.value)}
      </p>
      <div className="grid gap-1">
        <p className="m-0 flex min-w-0 items-baseline gap-2 text-ui-sm text-text-tertiary">
          <span className="flex-none">{t("desktop.workbench.detail.settings.source")}</span>
          <span className="flex-none text-text-secondary">
            {t("desktop.workbench.detail.settings.wins", { scope: scopeText(line.scope) })}
          </span>
          {path !== undefined && (
            <span className="min-w-0 truncate font-mono text-mono-sm">{path}</span>
          )}
        </p>
        {shadowed.length > 0 && (
          <ShadowedList rows={shadowed} defaultOpen={line.scope === "thread"} />
        )}
      </div>
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
          <div className="grid gap-1">
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
 * 설정 화면 자리(settings slot, c02 `SettingsSlot`): 확장이 설정 화면을 하나 냈으면 줄 아래에 연한 머리와 그 화면을 읽기 전용으로 붙인다.
 * 머리는 "확장이 그린 부분 · 읽기 전용"이다. 화면의 이름은 낭독기용 이름으로만 쓴다. 입력은 위 줄의 범위 값뿐이다.
 */
function SettingsSlot(props: {
  readonly entry: { readonly title: string; readonly extension: string };
  readonly children: ReactNode;
}): ReactNode {
  return (
    <section aria-label={props.entry.title} className="grid gap-1 pt-3">
      <div className="flex min-w-0 items-baseline gap-2 text-ui-xs text-text-tertiary">
        <span>{t("desktop.workbench.detail.settings.slot")}</span>
        <span>{`· ${t("desktop.workbench.detail.settings.readOnly")}`}</span>
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
    const settings = new Map<string, EffectiveSetting>(
      got.value.values.map((setting): [string, EffectiveSetting] => [setting.key, setting]),
    );
    const rows = extSettingRowsOf(name, {
      defs: got.value.defs,
      values: got.value.values,
      hasThread: threadId !== null,
    });
    return ok(rows.map((row) => withSetting(row, settings)));
  }, [commands, name, threadId]);
  const read = useTabRead(`${name}\u0000${threadId ?? ""}`, link, load);
  return (
    <div className="grid max-w-[44rem] gap-1">
      <SettingsPanel read={read} hasSlot={slot !== undefined} />
      {slot !== undefined && (
        <SettingsSlot entry={slot}>
          <EntrySurface entry={slot} />
        </SettingsSlot>
      )}
    </div>
  );
}
