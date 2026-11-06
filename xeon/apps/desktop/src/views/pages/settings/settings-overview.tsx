import { Badge, Button, ListDescription, ListDescriptionRow, toast } from "@caustic/react";
import { Info, TriangleAlert } from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import type { SettingsView, ViewDiagnostic } from "@fresnel/client/settings";
import type { ReactNode } from "react";
import { useCommands } from "../../commands.ts";
import { useSafeMode } from "../../safe-mode-context.ts";
import { pathTermOf, type SettingsPathRow } from "./settings-file-paths.ts";
import { SettingSection } from "./settings-section.tsx";
import { diagnosticIdOf, TONE_CLASS } from "./settings-text.ts";

// 개요 탭(P-09 시안 `overview-tab.tsx`): "설정 파일"(경로는 `settings.readFile`의 `path`), "지금 상태", "화면 진단"(진단 복사) 카드.
const ROWS_CLASS =
  "rounded-none [--cs-size-list-term:9rem] [&_[data-slot=list-description-row]]:px-0";

const count = (n: number): string => t("desktop.settings.overview.count", { count: n });

/** 진단 종류별 줄 표식. 값이 없거나 겹친 것은 경고, 위젯·탭을 모르는 것은 안내다 */
function toneOf(code: ViewDiagnostic["code"]): "warning" | "info" {
  return code === "missingValue" || code === "duplicateKey" ? "warning" : "info";
}

export function OverviewPanels(props: {
  readonly view: SettingsView;
  /** 앱 업데이트 줄(웹에서는 아무것도 그리지 않는다) */
  readonly updatePanel: ReactNode;
  /** 사용자·프로젝트·관리 정책 설정 파일 경로. 읽지 못한 범위는 빠진다 */
  readonly filePaths: readonly SettingsPathRow[];
}): ReactNode {
  const commands = useCommands();
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
            {props.filePaths.map((row) => (
              <ListDescriptionRow
                key={row.scope}
                term={pathTermOf(row.scope)}
                mono
                copyValue={row.path}
              >
                {row.path}
              </ListDescriptionRow>
            ))}
          </ListDescription>
        </SettingSection>
      )}
      <SettingSection title={t("desktop.settings.overview.state")}>
        {props.updatePanel}
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
        <SettingSection
          title={t("desktop.settings.diagnostics.title")}
          end={
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                detach(
                  commands.copyDiagnostics().then((ok) => {
                    if (ok)
                      toast({ tone: "success", title: t("desktop.settings.overview.copied") });
                    return undefined;
                  }),
                  rethrow,
                );
              }}
            >
              {t("desktop.settings.overview.copyDiagnostics")}
            </Button>
          }
        >
          <ul className="m-0 grid list-none gap-1 p-0">
            {diagnostics.map((diagnostic) => {
              const tone = toneOf(diagnostic.code);
              const Icon = tone === "warning" ? TriangleAlert : Info;
              return (
                <li
                  key={`${diagnostic.code}:${diagnostic.key}`}
                  className="flex min-w-0 gap-2 py-1.5"
                >
                  <Icon
                    aria-hidden
                    className={`mt-0.5 size-icon-sm flex-none ${tone === "warning" ? "text-warning-text" : "text-text-tertiary"}`}
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
