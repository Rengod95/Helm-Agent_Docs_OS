// 프로젝트 패널 꼴 전환기(개발 빌드만, `BUILD_CHECKS`). 패널 머리 "프로젝트" 줄 끝의 작은 메뉴다. 고른 값은 localStorage에 남는다
// (찍기 도구도 이 키를 미리 정한다). 배포 빌드(`just desktop-ui`)로 묶은 앱에는 이 파일이 실리지 않는다.
import { t, type MessageId } from "@fresnel/client/i18n";
import { IconButton, Menu, MenuGroup, MenuHeading, MenuItem } from "@caustic/react";
import { Check, FlaskConical } from "@caustic/react/icons";
import type { ReactNode } from "react";
import {
  PANEL_VARIANTS,
  setPanelVariant,
  usePanelVariant,
  type PanelVariant,
} from "./panel-variant.ts";

const WORD: Readonly<Record<PanelVariant, MessageId>> = {
  tree: "desktop.projects.dev.tree",
  flat: "desktop.projects.dev.flat",
};

export function PanelSwitch(): ReactNode {
  const variant = usePanelVariant();
  return (
    <Menu
      size="sm"
      align="end"
      aria-label={t("desktop.projects.dev.menu")}
      trigger={
        <IconButton
          size="xs"
          variant="ghost"
          data-project-switch={variant}
          label={`${t("desktop.projects.dev.menu")}: ${t(WORD[variant])}`}
        >
          <FlaskConical />
        </IconButton>
      }
    >
      <MenuGroup>
        <MenuHeading>{t("desktop.projects.dev.menu")}</MenuHeading>
        {PANEL_VARIANTS.map((v) => (
          <MenuItem
            key={v}
            role="menuitemradio"
            selected={v === variant}
            icon={v === variant ? <Check /> : <span className="size-4" />}
            onSelect={() => {
              setPanelVariant(v);
            }}
          >
            {t(WORD[v])}
          </MenuItem>
        ))}
      </MenuGroup>
    </Menu>
  );
}
