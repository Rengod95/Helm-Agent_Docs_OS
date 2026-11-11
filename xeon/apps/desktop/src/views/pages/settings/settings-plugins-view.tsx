import { t } from "@fresnel/client/i18n";
import { Button } from "@caustic/react";
import { WandSparkles } from "@caustic/react/icons";
import { useContext, type ReactNode } from "react";
import { ShellStoreContext } from "../../../state/shell/index.ts";
import { useCommands } from "../../commands.ts";
import { FORM_CONTROL_SIZE, SettingSection } from "./settings-section.tsx";

// 설정 "플러그인" 구역 맨 위(L4.settings-ui, desktop-ux DP-93 [결정: 2026-11-11 사용자]). 설정은 정책만 둔다:
// 플러그인 목록과 켜기·끄기는 플레이그라운드(쓰는 곳)와 크래프트(만들고 고치는 곳)가 맡는다. 이 카드는 그 자리로 보내는 한 줄이다.
// 전에는 내장 19개를 포함한 확장 목록과 스위치가 여기 있었고 신뢰 확인 없이 켰다. 목록을 빼면서 그 길도 없어졌다.

/** 안내 한 줄과 "플레이그라운드 열기". `onOpen`이 없으면(셸 밖 시험) 단추를 그리지 않는다 */
export function PluginsPanelView(props: { readonly onOpen?: (() => void) | undefined }): ReactNode {
  return (
    <SettingSection body="plain" label={t("desktop.settings.plugins.moved.title")}>
      <div className="flex min-w-0 items-center gap-3">
        <WandSparkles aria-hidden className="size-4 flex-none text-text-tertiary" />
        <p className="m-0 min-w-0 flex-1 text-ui text-text-secondary">
          {t("desktop.settings.plugins.moved.body")}
        </p>
        {props.onOpen === undefined ? null : (
          <Button size={FORM_CONTROL_SIZE} variant="outline" onClick={props.onOpen}>
            {t("desktop.settings.plugins.moved.open")}
          </Button>
        )}
      </div>
    </SettingSection>
  );
}

export function PluginsPanel(): ReactNode {
  const commands = useCommands();
  const shell = useContext(ShellStoreContext)?.actions;
  return (
    <PluginsPanelView
      onOpen={
        shell === undefined
          ? undefined
          : () => {
              shell.switchArea("chat");
              commands.showScreen("chat");
              shell.updatePlace({ screen: "plugins", scroll: 0 });
            }
      }
    />
  );
}
