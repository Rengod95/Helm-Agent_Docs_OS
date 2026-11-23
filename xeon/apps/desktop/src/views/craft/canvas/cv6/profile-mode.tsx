// 왼쪽 패널 프로필 고르기 아래의 실행 방식 줄(pfMode, AGE-71 질문 3 [결정: 2026-11-23 사용자] "프로필이 정하고, 모든 프로필은 기본값으로
// 실행방식 전체 허용"). 대화의 실행 방식은 그 대화의 프로필이 정한다. 프로필에 값이 없으면 "모두 허용"이다(엔진 `profile` 층과 같은 규칙).
// 줄의 모양: 왼쪽에 이름표와 정보 아이콘(모두 허용이 뜻하는 것), 오른쪽에 대화 입력창의 실행 방식 칩과 같은 칩(같은 아이콘, 같은 말, 모두 허용은
// 위험 색). 누르면 같은 메뉴 줄(`PermissionModeMenuItems`)이 열리고, 고르면 그 프로필에 `profile.put`으로 바로 쓴다. 기본 프로필도 바꿀 수 있다.
// 엔진이 거절하면 줄 아래에 까닭이 보인다. 표본 보기(엔진 값이 없음)에서는 줄을 두지 않는다.
import { t, type MessageId } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import type { PermissionMode } from "@fresnel/contracts/services";
import { Button, cn, Menu } from "@caustic/react";
import { useEffect, useState, type ReactElement } from "react";
import { profileErrorText } from "../../../compose/compose-text.ts";
import { InfoTip } from "../../info-tip.tsx";
import {
  bypassAllowedOf,
  COMPOSER_CHIP_CLASS,
  modeIcon,
  permissionModeChipText,
  PermissionModeMenuItems,
  permissionModeToneOf,
} from "../permission-mode-source.ts";
import { useProfileCommands } from "../profile-source.ts";
import { profileModeOf } from "./live.ts";
import { Refusal } from "./profile-menu.tsx";
import { setProfileMode, useCanvasStore } from "./store.ts";

/** 엔진이 모르는 값일 때 칩이 보이는 모드(입력창 칩과 같다: 기본 모드 글에 점선 밑줄, 메뉴에서는 어느 줄도 고르지 않는다) */
const UNKNOWN_SHOWN: PermissionMode = "default";

export function ProfileModeRow(props: { readonly profileId: string }): ReactElement | null {
  const store = useCanvasStore();
  const commands = useProfileCommands();
  const [bypassAllowed, setBypassAllowed] = useState(false);
  const [busy, setBusy] = useState(false);
  // 거절 까닭은 그 프로필의 것만 보인다(다른 프로필을 고르면 사라진다)
  const [failure, setFailure] = useState<{
    readonly profileId: string;
    readonly text: MessageId;
  } | null>(null);
  // "모두 허용"의 허락은 관리 설정만 정한다. 모르면 숨기고(입력창 칩과 같다), 지금 값이 모두 허용이면 그 줄은 남는다
  useEffect(() => {
    let alive = true;
    detach(
      commands.bypassAllowed().then((got) => {
        if (alive) setBypassAllowed(got.ok && bypassAllowedOf(got.value));
        return undefined;
      }),
      rethrow,
    );
    return () => {
      alive = false;
    };
  }, [commands]);

  const live = store.live;
  const saved = live?.saved[props.profileId];
  if (live === null || saved === undefined) return null;
  const read = profileModeOf(saved, live.common);
  const mode = read ?? UNKNOWN_SHOWN;
  const label = t("desktop.craft.canvas.cv9.profileMode.label");
  const unknown = read === null ? t("desktop.craft.canvas.cv9.profileMode.unknown") : null;
  const danger = read !== null && permissionModeToneOf(read) === "danger";
  const choose = (next: PermissionMode): void => {
    setBusy(true);
    setFailure(null);
    detach(
      setProfileMode(commands, props.profileId, next).then((done) => {
        setBusy(false);
        if (!done.ok)
          setFailure({ profileId: props.profileId, text: profileErrorText(done.error) });
        return undefined;
      }),
      rethrow,
    );
  };
  return (
    <div data-slot="profile-mode" className="flex flex-col gap-1.5">
      <div className="flex h-7 items-center justify-between gap-1 ps-1">
        <span className="flex min-w-0 items-center gap-1 text-caption text-text-tertiary">
          <span className="truncate">{label}</span>
          <InfoTip text={t("desktop.craft.canvas.cv9.profileMode.help")} />
        </span>
        <Menu
          size="sm"
          align="end"
          aria-label={label}
          className="w-80"
          trigger={
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              data-state={read === null ? "unsure" : "ready"}
              aria-label={[`${label}: ${permissionModeChipText(mode)}`, unknown]
                .filter((part) => part !== null)
                .join(", ")}
              title={unknown ?? undefined}
              className={cn(
                COMPOSER_CHIP_CLASS,
                danger && "text-danger-text hover:text-danger-text",
              )}
            >
              {modeIcon(mode)}
              <span
                className={cn(
                  "truncate",
                  read === null && "underline decoration-dotted decoration-1 underline-offset-4",
                )}
              >
                {permissionModeChipText(mode)}
              </span>
            </Button>
          }
        >
          <PermissionModeMenuItems
            mode={mode}
            bypassAllowed={bypassAllowed}
            marked={read !== null}
            onChange={choose}
          />
        </Menu>
      </div>
      {failure === null || failure.profileId !== props.profileId ? null : (
        <Refusal text={t(failure.text)} />
      )}
    </div>
  );
}
