import { Button, ListDescription, ListDescriptionRow, toast } from "@caustic/react";
import { t } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import type { ReactNode } from "react";
import { useCommands } from "../../commands.ts";
import { useDesktopShell } from "../../desktop-shell-context.ts";
import { SettingsProblemBanner } from "../../settings-problem-banner.tsx";
import { StoreReplacedBanner } from "../../store-replaced-banner.tsx";
import { pathTermOf, shortenHome, type SettingsPathRow } from "./settings-file-paths.ts";
import { FORM_CONTROL_SIZE, SettingSection } from "./settings-section.tsx";
import {
  UpdateButtons,
  UpdateNote,
  UpdateSummaryValue,
  useUpdateSlot,
  type UpdateSlot,
} from "./settings-update-view.tsx";

// 옛 개요 탭에서 옮겨 온 부분들(L4.settings-ui §4.1.1 [결정: 2026-11-11 사용자]). 개요 구역은 없다.
//   - `SettingsBanners`: 설정 파일 문제 띠와 저장소 교체 띠. 모든 구역 맨 위에 보인다.
//   - `AboutPanel`: 일반 구역의 "정보와 진단"(요약 세 칸, 업데이트 실패 원인, 업데이트 확인·진단 복사·로그 폴더 단추 한 줄. DP-86).
//   - `SettingsFilesPanel`: 데이터 구역의 "설정 파일"(경로 줄). 화면에서 뺀 키는 이 파일로 바꾼다.
// "지금 상태"(범위별 개수)와 화면 진단 카드는 범위 중심 요약이라 뺐다.
const ROWS_CLASS =
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

/** 정보와 진단(DP-86): 요약 세 칸(앱 버전, 엔진 버전, 업데이트) + 업데이트 실패 원인 줄 + 같은 크기 단추 한 줄 */
export function AboutPanel(): ReactNode {
  const commands = useCommands();
  const shell = useDesktopShell();
  const update = useUpdateSlot();
  const versions = commands.versions();
  return (
    <AboutCardView
      appVersion={versions.app}
      engineVersion={versions.engine}
      update={update}
      onCopy={() => {
        detach(
          commands.copyDiagnostics().then((ok) => {
            if (ok) toast({ tone: "success", title: t("desktop.settings.overview.copied") });
            return undefined;
          }),
          rethrow,
        );
      }}
      onOpenLogs={
        shell === null
          ? null
          : () => {
              detach(
                shell.invoke("open_log_dir").then(
                  () => undefined,
                  () => {
                    toast({ tone: "danger", title: t("desktop.settings.about.openLogsFailed") });
                  },
                ),
                rethrow,
              );
            }
      }
    />
  );
}

export interface AboutCardViewProps {
  readonly appVersion: string;
  readonly engineVersion: string | null;
  /** 업데이트 문맥. 없으면(웹) 업데이트 칸과 단추가 없다 */
  readonly update: UpdateSlot | null;
  readonly onCopy: () => void;
  /** 로그 폴더 열기. 없으면(웹) 단추가 없다 */
  readonly onOpenLogs: (() => void) | null;
}

/** 요약 칸 하나: 이름(12 tertiary) 위, 값 아래 */
function SummaryCell(props: { readonly term: string; readonly children: ReactNode }): ReactNode {
  return (
    <div data-slot="about-cell" className="grid min-w-0 content-start gap-1">
      <span className="text-ui-sm text-text-tertiary">{props.term}</span>
      {props.children}
    </div>
  );
}

export function AboutCardView(props: AboutCardViewProps): ReactNode {
  const { update } = props;
  return (
    <SettingSection title={t("desktop.settings.about.title")} body="plain">
      <div data-slot="settings-about" className="grid gap-3">
        <div className="grid grid-cols-3 gap-4">
          <SummaryCell term={t("desktop.settings.about.appVersion")}>
            <span className="truncate font-mono text-mono-sm text-text-primary">
              {props.appVersion}
            </span>
          </SummaryCell>
          <SummaryCell term={t("desktop.settings.about.engineVersion")}>
            <span className="truncate font-mono text-mono-sm text-text-primary">
              {props.engineVersion ?? t("desktop.settings.about.engineUnknown")}
            </span>
          </SummaryCell>
          {update === null ? null : (
            <SummaryCell term={t("desktop.update.line.title")}>
              <UpdateSummaryValue state={update.state} />
            </SummaryCell>
          )}
        </div>
        {update === null ? null : <UpdateNote slot={update} />}
        <div
          data-slot="settings-about-actions"
          className="-mx-4 flex flex-wrap items-center gap-2 border-t border-border-subtle px-4 pt-3"
        >
          {update === null ? null : <UpdateButtons slot={update} />}
          <Button size={FORM_CONTROL_SIZE} variant="outline" onClick={props.onCopy}>
            {t("desktop.settings.overview.copyDiagnostics")}
          </Button>
          {props.onOpenLogs === null ? null : (
            <Button size={FORM_CONTROL_SIZE} variant="outline" onClick={props.onOpenLogs}>
              {t("desktop.settings.about.openLogs")}
            </Button>
          )}
        </div>
      </div>
    </SettingSection>
  );
}
