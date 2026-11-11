import { Select, SelectOption, toast } from "@caustic/react";
import { t, type MessageId } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import { useState, type ReactNode } from "react";
import { InfoTip } from "../../craft/info-tip.tsx";
import {
  THEME_PREFS,
  ZOOM_STEPS,
  type AppearancePort,
  type AppearancePrefs,
  type MotionPref,
  type ThemePref,
} from "../../appearance-prefs.ts";
import { useDesktopShell } from "../../desktop-shell-context.ts";
import { TRANSCRIPT_DETAILS, type TranscriptDetail } from "../../transcript-detail.ts";
import { SettingSection } from "./settings-section.tsx";

// 설정 "일반" 구역의 "화면" 묶음(시안 e01 `Appearance`): 테마, 화면 크기, 움직임 줄이기, 대화 기록의 생각·도구 표시 정도.
// 테마는 cyZ에서 더했다(L4.settings-ui §4.1.1 [결정: 2026-11-11 사용자]). 행 모양은 설정 항목 행(`FieldRow` 한 줄 행)과 같다.
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

const THEME_LABEL: Readonly<Record<ThemePref, MessageId>> = {
  system: "desktop.settings.appearance.theme.system",
  light: "desktop.settings.appearance.theme.light",
  dark: "desktop.settings.appearance.theme.dark",
};

function Row(props: {
  readonly label: MessageId;
  readonly info: MessageId;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div data-slot="settings-field" className="flex min-h-8 items-center gap-6 py-3">
      <span className="flex min-w-0 flex-1 items-center gap-1.5 text-ui font-medium text-text-primary">
        {t(props.label)}
        <InfoTip text={t(props.info)} />
      </span>
      {props.children}
    </div>
  );
}

function AppearancePanelView(props: AppearancePanelViewProps): ReactNode {
  const { prefs } = props;
  return (
    <SettingSection title={t("desktop.settings.part.display")}>
      <Row label="desktop.settings.appearance.theme" info="desktop.settings.appearance.theme.info">
        <Select
          size="sm"
          aria-label={t("desktop.settings.appearance.theme")}
          value={prefs.theme}
          onValueChange={(next) => {
            const theme = THEME_PREFS.find((option) => option === next);
            if (theme !== undefined) props.onTheme(theme);
          }}
          className="w-56"
        >
          {THEME_PREFS.map((theme) => (
            <SelectOption key={theme} value={theme}>
              {t(THEME_LABEL[theme])}
            </SelectOption>
          ))}
        </Select>
      </Row>
      <Row
        label="desktop.settings.appearance.motion"
        info="desktop.settings.appearance.motion.info"
      >
        <Select
          size="sm"
          aria-label={t("desktop.settings.appearance.motion")}
          value={prefs.motion}
          onValueChange={(next) => props.onMotion(next === "reduce" ? "reduce" : "system")}
          className="w-56"
        >
          <SelectOption value="system">
            {t("desktop.settings.appearance.motion.system")}
          </SelectOption>
          <SelectOption value="reduce">{t("desktop.settings.appearance.motion.on")}</SelectOption>
        </Select>
      </Row>
      <Row label="desktop.settings.appearance.zoom" info="desktop.settings.appearance.zoom.info">
        <Select
          size="sm"
          aria-label={t("desktop.settings.appearance.zoom")}
          value={String(prefs.zoom)}
          onValueChange={(next) => {
            const zoom = ZOOM_STEPS.find((step) => String(step) === next);
            if (zoom !== undefined) props.onZoom(zoom);
          }}
          className="w-56"
        >
          {ZOOM_STEPS.map((step) => (
            <SelectOption key={step} value={String(step)}>
              {`${step}%`}
            </SelectOption>
          ))}
        </Select>
      </Row>
      <Row
        label="desktop.settings.appearance.transcriptDetail"
        info="desktop.settings.appearance.transcriptDetail.info"
      >
        <Select
          size="sm"
          aria-label={t("desktop.settings.appearance.transcriptDetail")}
          value={prefs.transcriptDetail}
          onValueChange={(next) => {
            const detail = TRANSCRIPT_DETAILS.find((option) => option === next);
            if (detail !== undefined) props.onTranscriptDetail(detail);
          }}
          className="w-56"
        >
          <SelectOption value="full">
            {t("desktop.settings.appearance.transcriptDetail.full")}
          </SelectOption>
          <SelectOption value="summary">
            {t("desktop.settings.appearance.transcriptDetail.summary")}
          </SelectOption>
          <SelectOption value="hidden">
            {t("desktop.settings.appearance.transcriptDetail.hidden")}
          </SelectOption>
        </Select>
      </Row>
    </SettingSection>
  );
}
