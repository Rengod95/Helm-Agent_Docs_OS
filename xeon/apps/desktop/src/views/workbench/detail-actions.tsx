// P-17 상세의 머리 행동(plugHead, AGE-76): 상세도 다른 화면처럼 시스템 머리줄(`ScreenHeader`)을 그대로 쓰고, 그 왼쪽에 목록으로 돌아가는
// 꺾쇠 아이콘 단추를, 오른쪽에 프로필에 넣기, 테스트 챗, 내보내기, "…" 메뉴(지우기)를 둔다. 앱 핵심 플러그인은 행동 대신 자물쇠 문장이다.
// 크기는 머리 컨트롤 단계 하나(`HEADER_CONTROL_SIZE`, 32)이고 목록 머리의 합치기, 플러그인 가져오기와 같다.
import { t } from "@fresnel/client/i18n";
import { rowOf } from "@fresnel/client/workbench";
import type { ExtListEntry } from "@fresnel/contracts/wire";
import { IconButton, Menu, MenuItem, Tooltip } from "@caustic/react";
import { ChevronLeft, Ellipsis, Lock } from "@caustic/react/icons";
import type { ReactNode } from "react";
import { TestChatButton } from "../craft/test-chat/test-chat-button.tsx";
import { HEADER_CONTROL_SIZE } from "../shell/screen-header.tsx";
import { ExportExtension } from "./export-extension.tsx";
import { ProfilePutMenu, type ProfileSetLoad } from "./profile-put-menu.tsx";
import { removableOf } from "./remove-model.ts";

/** 머리 왼쪽의 "목록으로": 왼쪽 꺾쇠 아이콘 단추(머리 컨트롤 크기). 이름은 낭독기와 툴팁이 같이 쓴다 */
export function DetailBack(props: { readonly onBack: () => void }): ReactNode {
  const label = t("desktop.workbench.detail.back");
  return (
    <Tooltip content={label} side="bottom">
      <IconButton
        size={HEADER_CONTROL_SIZE}
        variant="ghost"
        label={label}
        className="-ms-1.5 flex-none"
        onClick={props.onBack}
      >
        <ChevronLeft aria-hidden />
      </IconButton>
    </Tooltip>
  );
}

/** 앱 핵심 플러그인의 자물쇠 문장. 끄기, 지우기, 프로필에 넣기 대신 늘 보인다(정보 아이콘 뒤에 숨기지 않는다) */
function CoreLockLine(): ReactNode {
  return (
    <span className="inline-flex items-center gap-1.5 text-ui text-text-secondary">
      <Lock aria-hidden className="size-icon-md" />
      <span>{t("desktop.workbench.core.locked")}</span>
    </span>
  );
}

/** 머리 오른쪽 행동 묶음: 프로필에 넣기(체크 메뉴), 테스트 챗, 내보내기, "…" 메뉴(지우기). 앱 핵심이면 자물쇠 문장 하나 */
export function DetailActions(props: {
  readonly entry: ExtListEntry;
  readonly profiles: ProfileSetLoad;
  readonly onRemove: () => void;
}): ReactNode {
  const { entry } = props;
  const row = rowOf(entry);
  if (row.appCore) return <CoreLockLine />;
  const removable = removableOf(entry);
  return (
    <span className="inline-flex flex-none items-center gap-2">
      <ProfilePutMenu
        name={entry.name}
        title={row.displayName ?? row.name}
        load={props.profiles}
        size={HEADER_CONTROL_SIZE}
      />
      <TestChatButton plugin={entry.name} />
      {removable && <ExportExtension entry={entry} />}
      {removable && (
        <Menu
          size="sm"
          align="end"
          aria-label={t("desktop.workbench.detail.menu")}
          trigger={
            <IconButton
              size={HEADER_CONTROL_SIZE}
              variant="ghost"
              label={t("desktop.workbench.detail.menu")}
            >
              <Ellipsis aria-hidden />
            </IconButton>
          }
        >
          <MenuItem onSelect={props.onRemove}>{t("desktop.workbench.remove.open")}</MenuItem>
        </Menu>
      )}
    </span>
  );
}
