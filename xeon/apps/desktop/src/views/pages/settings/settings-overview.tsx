import { Badge, Button, ListDescription, ListDescriptionRow, toast } from "@caustic/react";
import { CircleAlert, Info, TriangleAlert } from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import type { SettingsView } from "@fresnel/client/settings";
import type { ReactNode } from "react";
import { useCommands } from "../../commands.ts";
import { useDesktopShell } from "../../desktop-shell-context.ts";
import { useSafeMode } from "../../safe-mode-context.ts";
import { pathTermOf, shortenHome, type SettingsPathRow } from "./settings-file-paths.ts";
import { SettingSection } from "./settings-section.tsx";
import {
  diagnosticIdOf,
  diagnosticToneOf,
  TONE_CLASS,
  type DiagnosticTone,
} from "./settings-text.ts";

// 개요 탭(P-09 시안 `overview-tab.tsx`): "설정 파일"(경로는 `settings.readFile`의 `path`), "지금 상태", "화면 진단"(진단 복사) 카드.
export const ROWS_CLASS =
  "rounded-none [--cs-size-list-term:9rem] [&_[data-slot=list-description-row]]:px-0 @max-[26rem]:[&_[data-slot=list-description-row]]:grid-cols-[minmax(0,1fr)_auto] @max-[26rem]:[&_[data-slot=list-description-term]]:col-span-full";

const count = (n: number): string => t("desktop.settings.overview.count", { count: n });

/** 진단 줄의 아이콘과 아이콘 색(목업 `overview-tab.tsx`의 DIAG 줄과 같다). 색은 글자와 함께 쓴다 */
const DIAGNOSTIC_ICON = { danger: CircleAlert, warning: TriangleAlert, info: Info };
const DIAGNOSTIC_ICON_CLASS: Readonly<Record<DiagnosticTone, string>> = {
  danger: "text-danger-text",
  warning: "text-warning-text",
  info: "text-text-tertiary",
};

export function OverviewPanels(props: {
  readonly view: SettingsView;
  /** 앱 업데이트 줄(웹에서는 아무것도 그리지 않는다) */
  readonly updatePanel: ReactNode;
  /** 사용자·프로젝트·관리 정책 설정 파일 경로 줄. 연결이 없으면 빈 목록이다. 경로를 모르면 줄은 `없음`으로 보인다 */
  readonly filePaths: readonly SettingsPathRow[];
}): ReactNode {
  const commands = useCommands();
  const shell = useDesktopShell();
  const versions = commands.versions();
  const { overview, diagnostics } = props.view;
  const safeMode = useSafeMode();
  const changed = Object.entries(overview.countsByScope).reduce(
    (sum, [scope, n]) => (scope === "default" ? sum : sum + n),
    0,
  );
  return (
    <>
      {props.filePaths.length === 0 ? null : (
        <SettingSection title={t("desktop.settings.overview.files.title")}>
          <ListDescription
            variant="ghost"
            size="xs"
            aria-label={t("desktop.settings.overview.files.title")}
            className={ROWS_CLASS}
          >
            {props.filePaths.map((row) =>
              row.path === null ? (
                <ListDescriptionRow key={row.scope} term={pathTermOf(row.scope)}>
                  {t("desktop.settings.overview.files.none")}
                </ListDescriptionRow>
              ) : (
                <ListDescriptionRow
                  key={row.scope}
                  term={pathTermOf(row.scope)}
                  mono
                  copyValue={row.path}
                >
                  {shortenHome(row.path)}
                </ListDescriptionRow>
              ),
            )}
          </ListDescription>
        </SettingSection>
      )}
      <SettingSection title={t("desktop.settings.about.title")}>
        <ListDescription
          variant="ghost"
          size="xs"
          aria-label={t("desktop.settings.about.title")}
          className={ROWS_CLASS}
        >
          <ListDescriptionRow term={t("desktop.settings.about.appVersion")} mono>
            {versions.app}
          </ListDescriptionRow>
          <ListDescriptionRow term={t("desktop.settings.about.engineVersion")} mono>
            {versions.engine ?? t("desktop.settings.about.engineUnknown")}
          </ListDescriptionRow>
        </ListDescription>
        {props.updatePanel}
        <div className="flex flex-wrap items-center gap-2 pt-2" data-slot="settings-about-actions">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              detach(
                commands.copyDiagnostics().then((ok) => {
                  if (ok) toast({ tone: "success", title: t("desktop.settings.overview.copied") });
                  return undefined;
                }),
                rethrow,
              );
            }}
          >
            {t("desktop.settings.overview.copyDiagnostics")}
          </Button>
          {shell === null ? null : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                detach(
                  shell.invoke("open_log_dir").then(
                    () => undefined,
                    () => {
                      toast({ tone: "danger", title: t("desktop.settings.about.openLogsFailed") });
                    },
                  ),
                  rethrow,
                );
              }}
            >
              {t("desktop.settings.about.openLogs")}
            </Button>
          )}
        </div>
      </SettingSection>
      <SettingSection title={t("desktop.settings.overview.state")}>
        <ListDescription
          variant="ghost"
          size="xs"
          aria-label={t("desktop.settings.overview.state")}
          className={ROWS_CLASS}
        >
          <ListDescriptionRow term={t("desktop.settings.overview.changed")}>
            {count(changed)}
          </ListDescriptionRow>
          <ListDescriptionRow term={t("desktop.settings.overview.locked")}>
            {count(overview.locked.length)}
          </ListDescriptionRow>
          <ListDescriptionRow term={t("desktop.settings.overview.pendingRestart")}>
            {overview.pendingRestart.length === 0 ? (
              count(0)
            ) : (
              <Badge size="sm" className={TONE_CLASS.warning}>
                {count(overview.pendingRestart.length)}
              </Badge>
            )}
          </ListDescriptionRow>
          <ListDescriptionRow term={t("desktop.settings.overview.pendingNextTurn")}>
            {count(overview.pendingNextTurn.length)}
          </ListDescriptionRow>
          <ListDescriptionRow term={t("desktop.settings.overview.deprecated")}>
            {count(overview.deprecatedInUse.length)}
          </ListDescriptionRow>
          {safeMode === null ? null : (
            <ListDescriptionRow term={t("desktop.settings.overview.safeMode")}>
              {t(
                safeMode.active ? "desktop.settings.overview.on" : "desktop.settings.overview.off",
              )}
            </ListDescriptionRow>
          )}
        </ListDescription>
      </SettingSection>
      {diagnostics.length === 0 ? null : (
        <SettingSection title={t("desktop.settings.diagnostics.title")}>
          <ul className="m-0 grid list-none gap-1 p-0">
            {diagnostics.map((diagnostic) => {
              const tone = diagnosticToneOf(diagnostic.code);
              const Icon = DIAGNOSTIC_ICON[tone];
              return (
                <li
                  key={`${diagnostic.code}:${diagnostic.key}`}
                  className="flex min-w-0 gap-2 py-1.5"
                >
                  <Icon
                    aria-hidden
                    className={`mt-0.5 size-icon-sm flex-none ${DIAGNOSTIC_ICON_CLASS[tone]}`}
                  />
                  <div className="grid min-w-0 gap-0.5">
                    <span className="text-ui text-text-primary">
                      {t(diagnosticIdOf(diagnostic.code))}
                    </span>
                    <span className="truncate font-mono text-mono-sm text-text-tertiary">
                      {diagnostic.key}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </SettingSection>
      )}
    </>
  );
}
