import { Button, ListDescription, ListDescriptionRow, toast } from "@caustic/react";
import { t } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import type { ReactNode } from "react";
import { useCommands } from "../../commands.ts";
import { useDesktopShell } from "../../desktop-shell-context.ts";
import { SettingsProblemBanner } from "../../settings-problem-banner.tsx";
import { StoreReplacedBanner } from "../../store-replaced-banner.tsx";
import { pathTermOf, shortenHome, type SettingsPathRow } from "./settings-file-paths.ts";
import { SettingSection } from "./settings-section.tsx";

// 옛 개요 탭에서 옮겨 온 부분들(L4.settings-ui §4.1.1 [결정: 2026-11-11 사용자]). 개요 구역은 없다.
//   - `SettingsBanners`: 설정 파일 문제 띠와 저장소 교체 띠. 모든 구역 맨 위에 보인다.
//   - `AboutPanel`: 일반 구역의 "업데이트와 정보"(버전, 업데이트, 진단 복사, 로그 폴더).
//   - `SettingsFilesPanel`: 데이터 구역의 "설정 파일"(경로 줄). 화면에서 뺀 키는 이 파일로 바꾼다.
// "지금 상태"(범위별 개수)와 화면 진단 카드는 범위 중심 요약이라 뺐다.
// "정보와 진단"의 진단 복사·로그 폴더 열기는 구역 공통 동작이라 머리 오른쪽 끝에 둔다 [결정: 2026-11-08 사용자, dsB]
export const ROWS_CLASS =
  "rounded-none [--cs-size-list-term:9rem] [&_[data-slot=list-description-row]]:px-0 @max-[26rem]:[&_[data-slot=list-description-row]]:grid-cols-[minmax(0,1fr)_auto] @max-[26rem]:[&_[data-slot=list-description-term]]:col-span-full";

/** 모든 구역 맨 위의 알림 띠. 띠가 없으면 아무것도 그리지 않는다 */
export function SettingsBanners(props: {
  /** 띠의 "파일로 보기"가 여는 동작(사용자 파일) */
  readonly onOpenFile?: (() => void) | undefined;
  /** "파일로 보기"를 잠글지(읽기 전용 연결이거나 편집기가 열려 있을 때) */
  readonly openFileDisabled?: boolean | undefined;
}): ReactNode {
  return (
    <>
      <SettingsProblemBanner
        onOpenFile={props.onOpenFile}
        openFileDisabled={props.openFileDisabled}
      />
      <StoreReplacedBanner />
    </>
  );
}

/** 설정 파일 경로 줄(사용자·프로젝트·관리 정책). 줄이 없으면(연결 전) 그리지 않는다 */
export function SettingsFilesPanel(props: {
  readonly filePaths: readonly SettingsPathRow[];
}): ReactNode {
  if (props.filePaths.length === 0) return null;
  return (
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
  );
}

/** 업데이트와 정보: 버전 두 줄과 업데이트 줄. 머리 끝에 진단 복사와 로그 폴더 열기(웹에는 로그 폴더가 없다) */
export function AboutPanel(props: {
  /** 앱 업데이트 줄(웹에서는 아무것도 그리지 않는다) */
  readonly updatePanel: ReactNode;
}): ReactNode {
  const commands = useCommands();
  const shell = useDesktopShell();
  const versions = commands.versions();
  return (
    <SettingSection
      title={t("desktop.settings.about.title")}
      end={
        <div className="flex flex-none items-center gap-2" data-slot="settings-about-actions">
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
                      toast({
                        tone: "danger",
                        title: t("desktop.settings.about.openLogsFailed"),
                      });
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
      }
    >
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
    </SettingSection>
  );
}
