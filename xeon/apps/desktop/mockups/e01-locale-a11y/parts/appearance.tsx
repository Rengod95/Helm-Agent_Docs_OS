// P-09 "외관" 탭의 화면 언어·접근성 묶음(N-49, N-50). 공용 설정 틀(_settings) 위. 영어 화면에서 설정 행이 어떻게 줄어드는지도 본다.
// 언어를 바꾸면 문구 묶음을 읽고 다시 그린다(목업은 ?lang=en으로 다시 읽음). 실패하면 Select를 되돌리고 행 아래 오류 한 줄(FieldError 자리).
import { Button, Select, SelectOption } from "@caustic/react";
import { SettingRow, SettingSection } from "../../_settings/row";
import { SettingsFrame } from "../../_settings/frame";
import { L2, T } from "../../_shell";
import type { S } from "../flow";

export function Appearance({
  s,
  onLang,
  onReduced,
  onContrast,
  onShortcuts,
}: {
  s: S;
  onLang: (v: "system" | "ko" | "en") => void;
  onReduced: (on: boolean) => void;
  onContrast: (on: boolean) => void;
  onShortcuts: () => void;
}) {
  return (
    <SettingsFrame tab="appearance" onTabSelect={() => {}}>
      <SettingSection title={L2("화면", "Display")}>
        <SettingRow
          label={T.uiLanguage}
          k="ui.locale"
          scope="user"
          apply="now"
          hint={
            s.langBusy
              ? L2("문구 묶음을 읽는 중이에요…", "Loading strings…")
              : L2(
                  "대화 내용과 확장 이름의 원문은 바꾸지 않아요.",
                  "Conversation text and extension source names stay as they are.",
                )
          }
          error={
            s.langFailed
              ? L2(
                  "영어 문구 묶음을 읽지 못해 한국어로 뒀어요. 원인은 진단 화면에 있어요.",
                  "Couldn't load the English strings, so the app stays in Korean. Diagnostics has the cause.",
                )
              : undefined
          }
        >
          <Select
            size="sm"
            aria-label={T.uiLanguage}
            value={s.langPick}
            disabled={s.langBusy}
            onValueChange={(v) => onLang(v as "system" | "ko" | "en")}
            className="w-56"
          >
            <SelectOption value="system">
              {L2("시스템 따름(한국어)", "Follow system (Korean)")}
            </SelectOption>
            <SelectOption value="ko">한국어</SelectOption>
            <SelectOption value="en">English</SelectOption>
          </Select>
        </SettingRow>
        <SettingRow
          label={L2("테마", "Theme")}
          k="l4.desktop.appearance.theme"
          scope="user"
          apply="now"
        >
          <Select size="sm" aria-label={L2("테마", "Theme")} defaultValue="system" className="w-56">
            <SelectOption value="system">{L2("시스템 따름", "Follow system")}</SelectOption>
            <SelectOption value="light">{L2("라이트", "Light")}</SelectOption>
            <SelectOption value="dark">{L2("다크", "Dark")}</SelectOption>
          </Select>
        </SettingRow>
        <SettingRow
          label={T.keybinding}
          k="l4.desktop.appearance.keybindings"
          scope="user"
          apply="now"
          hint={L2("바뀐 키 2개", "2 shortcuts changed")}
        >
          <div>
            <Button size="sm" tone="neutral" variant="outline" onClick={onShortcuts}>
              {L2("바로 가기 키 보기와 바꾸기", "View and change shortcuts")}
            </Button>
          </div>
        </SettingRow>
      </SettingSection>
      <SettingSection title={L2("접근성", "Accessibility")}>
        <SettingRow
          label={T.reducedMotion}
          k="l4.desktop.appearance.motion"
          scope="user"
          apply="now"
          hint={L2(
            "켜면 패널이 미끄러지지 않고, 글이 한 번에 나오고, 진행 표시가 멈춘 점으로 바뀌어요.",
            "Panels stop sliding, text appears at once and progress shows as a still dot.",
          )}
        >
          <Select
            size="sm"
            aria-label={T.reducedMotion}
            value={s.reduced ? "on" : "system"}
            onValueChange={(v) => onReduced(v === "on")}
            className="w-56"
          >
            <SelectOption value="system">
              {L2("시스템 따름(끔)", "Follow system (off)")}
            </SelectOption>
            <SelectOption value="on">{L2("켬", "On")}</SelectOption>
            <SelectOption value="off">{L2("끔", "Off")}</SelectOption>
          </Select>
        </SettingRow>
        <SettingRow
          label={T.highContrast}
          k="l4.desktop.appearance.contrast"
          scope="user"
          apply="now"
          hint={L2(
            "시스템 고대비(강제 색)를 켜면 면 대신 선으로 나누고, 초점은 두꺼운 테두리로 보여요.",
            "With system high contrast (forced colors) on, surfaces get outlines and focus gets a thick border.",
          )}
        >
          <Select
            size="sm"
            aria-label={T.highContrast}
            value={s.contrast === "off" ? "system" : "on"}
            onValueChange={(v) => onContrast(v === "on")}
            className="w-56"
          >
            <SelectOption value="system">
              {L2("시스템 따름(끔)", "Follow system (off)")}
            </SelectOption>
            <SelectOption value="on">{L2("늘 켬", "Always on")}</SelectOption>
          </Select>
        </SettingRow>
        <SettingRow
          label={L2("확대", "Zoom")}
          k="l4.desktop.appearance.zoom"
          scope="user"
          apply="now"
          hint={L2(
            "200%에서도 대화와 승인 카드는 가로 스크롤 없이 보여요.",
            "At 200% the conversation and approval cards still fit without sideways scrolling.",
          )}
        >
          <Select size="sm" aria-label={L2("확대", "Zoom")} defaultValue="100" className="w-56">
            {["90", "100", "125", "150", "200"].map((z) => (
              <SelectOption key={z} value={z}>
                {z}%
              </SelectOption>
            ))}
          </Select>
        </SettingRow>
      </SettingSection>
    </SettingsFrame>
  );
}
