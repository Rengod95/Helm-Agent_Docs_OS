import { SegmentedControl, SegmentedControlItem, toast } from "@caustic/react";
import { t, type MessageId } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import { useId, useState, type ReactNode } from "react";
import {
  ZOOM_STEPS,
  type AppearancePort,
  type AppearancePrefs,
  type MotionPref,
  type ThemePref,
} from "../../appearance-prefs.ts";
import { useDesktopShell } from "../../desktop-shell-context.ts";
import { TRANSCRIPT_DETAILS, type TranscriptDetail } from "../../transcript-detail.ts";
import { FORM_CONTROL_SIZE, SettingRow, SettingSection } from "./settings-section.tsx";
import { ThemePicker } from "./settings-theme-picker.tsx";

// 설정 "일반" 구역의 "화면" 묶음: 테마, 움직임 줄이기, 확대, 대화 기록의 생각·도구 표시 정도(L4.settings-ui DP-86 [결정: 2026-11-11 사용자]).
// 테마는 미리보기 타일(`settings-theme-picker.tsx`), 나머지는 segmented 한 줄이다(선택지가 짧고 2~5개라 드롭다운으로 숨기지 않는다).
// 값은 로컬 설정에 저장하고 저장되면 바로 화면에 건다(`appearance-prefs.ts`). 설명은 정보 아이콘 뒤에 둔다.
// 웹에는 셸 문맥이 없어 `AppearancePanel`이 아무것도 그리지 않는다. 고대비(강제 색)는 OS가 켜는 값이라 이 묶음에 없다.

export function AppearancePanel(): ReactNode {
  const shell = useDesktopShell();
  if (shell === null) return null;
  return <AppearancePanelBound port={shell.appearance} />;
}

function AppearancePanelBound(props: { readonly port: AppearancePort }): ReactNode {
  const { port } = props;
  const [prefs, setPrefs] = useState<AppearancePrefs>(() => port.get());
  const save = (next: AppearancePrefs, write: () => Promise<boolean>): void => {
    const before = prefs;
    setPrefs(next);
    detach(
      write().then((saved) => {
        // 저장하지 못하면 고른 값을 되돌리고 알린다
        if (saved) return null;
        setPrefs(before);
        toast({ tone: "danger", title: t("desktop.settings.appearance.saveFailed") });
        return null;
      }),
      rethrow,
    );
  };
  return (
    <AppearancePanelView
      prefs={prefs}
      onTheme={(theme) => save({ ...prefs, theme }, () => port.setTheme(theme))}
      onMotion={(motion) => save({ ...prefs, motion }, () => port.setMotion(motion))}
      onZoom={(zoom) => save({ ...prefs, zoom }, () => port.setZoom(zoom))}
      onTranscriptDetail={(transcriptDetail) =>
        save({ ...prefs, transcriptDetail }, () => port.setTranscriptDetail(transcriptDetail))
      }
    />
  );
}

interface AppearancePanelViewProps {
  readonly prefs: AppearancePrefs;
  readonly onTheme: (theme: ThemePref) => void;
  readonly onMotion: (motion: MotionPref) => void;
  readonly onZoom: (zoom: number) => void;
  readonly onTranscriptDetail: (detail: TranscriptDetail) => void;
}

const DETAIL_LABEL: Readonly<Record<TranscriptDetail, MessageId>> = {
  full: "desktop.settings.appearance.transcriptDetail.full",
  summary: "desktop.settings.appearance.transcriptDetail.summary",
  hidden: "desktop.settings.appearance.transcriptDetail.hidden",
};

/** 짧은 선택지 2~5개를 고르는 줄(DP-86): 이름표 왼쪽, segmented sm 오른쪽 */
function SegmentRow<T extends string>(props: {
  readonly label: MessageId;
  readonly info: MessageId;
  readonly value: T;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly onChange: (next: T) => void;
}): ReactNode {
  return (
    <SettingRow
      slot="settings-field"
      label={t(props.label)}
      info={t(props.info)}
      control={
        <SegmentedControl
          size={FORM_CONTROL_SIZE}
          aria-label={t(props.label)}
          value={props.value}
          onValueChange={(next) => {
            const found = props.options.find((option) => option.value === next);
            if (found !== undefined) props.onChange(found.value);
          }}
        >
          {props.options.map((option) => (
            <SegmentedControlItem key={option.value} value={option.value}>
              {option.label}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
      }
    />
  );
}

/**
 * 화면 묶음(DP-86): 테마는 미리보기 타일 셋(쌓는 줄), 움직임 줄이기·확대·생각과 도구 표시는 segmented 한 줄씩이다.
 * 선택지가 2~5개이고 이름이 짧아 드롭다운으로 숨기지 않는다.
 */
function AppearancePanelView(props: AppearancePanelViewProps): ReactNode {
  const { prefs } = props;
  const themeLabelId = useId();
  return (
    <SettingSection title={t("desktop.settings.part.display")}>
      <SettingRow
        slot="settings-field"
        layout="stacked"
        label={t("desktop.settings.appearance.theme")}
        labelId={themeLabelId}
        info={t("desktop.settings.appearance.theme.info")}
        control={
          <ThemePicker value={prefs.theme} onChange={props.onTheme} labelId={themeLabelId} />
        }
      />
      <SegmentRow<MotionPref>
        label="desktop.settings.appearance.motion"
        info="desktop.settings.appearance.motion.info"
        value={prefs.motion}
        options={[
          { value: "system", label: t("desktop.settings.appearance.motion.system") },
          { value: "reduce", label: t("desktop.settings.appearance.motion.on") },
        ]}
        onChange={props.onMotion}
      />
      <SegmentRow<string>
        label="desktop.settings.appearance.zoom"
        info="desktop.settings.appearance.zoom.info"
        value={String(prefs.zoom)}
        options={ZOOM_STEPS.map((step) => ({ value: String(step), label: `${String(step)}%` }))}
        onChange={(next) => {
          const zoom = ZOOM_STEPS.find((step) => String(step) === next);
          if (zoom !== undefined) props.onZoom(zoom);
        }}
      />
      <SegmentRow<TranscriptDetail>
        label="desktop.settings.appearance.transcriptDetail"
        info="desktop.settings.appearance.transcriptDetail.info"
        value={prefs.transcriptDetail}
        options={TRANSCRIPT_DETAILS.map((detail) => ({
          value: detail,
          label: t(DETAIL_LABEL[detail]),
        }))}
        onChange={props.onTranscriptDetail}
      />
    </SettingSection>
  );
}
