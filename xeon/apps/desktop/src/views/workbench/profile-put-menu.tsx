// "프로필에 넣기" 체크 메뉴와 프로필 목록 읽기(AGE-74, AGE-76 plugMin). 목록 줄과 상세 머리, 오류 알림이 같이 쓴다.
// 메뉴는 프로필마다 체크 칸 한 줄이다. 체크하면 캔버스와 같은 `profile.put`으로 그 프로필 끝에 넣고, 풀면 `profile.removePlugin`으로 뺀다.
// 리뷰를 거치지 않는다(설치가 이미 리뷰를 지났다). 앱 핵심 플러그인에는 이 메뉴를 그리지 않는다(부르는 쪽이 가른다).
import { t } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import { Button, Menu, MenuItem, toast } from "@caustic/react";
import { Check, ChevronDown } from "@caustic/react/icons";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useLinkPhase } from "../../state/engine/index.ts";
import type { CommandError } from "../commands.ts";
import { useCommands } from "../commands.ts";
import { profileTitleOf } from "../convo/profile-chip-model.ts";
import { inProfile, profileSetOf, withPlugin, type ProfileSet } from "./profile-use.ts";

/** 프로필 목록 읽기. 엔진에 붙으면 한 번 읽고, 넣고 뺀 뒤 `reload`로 다시 읽는다. null은 아직 못 읽었다는 뜻이다 */
export interface ProfileSetLoad {
  readonly set: ProfileSet | null;
  readonly reload: () => void;
}

export function useProfileSet(): ProfileSetLoad {
  const commands = useCommands();
  const live = useLinkPhase() === "live";
  const [set, setSet] = useState<ProfileSet | null>(null);
  // 늦게 온 읽기가 새 읽기를 덮지 않게 차례 번호를 둔다
  const seq = useRef(0);
  const reload = useCallback(() => {
    seq.current += 1;
    const mine = seq.current;
    detach(
      commands.profileCanvas.profiles().then((got) => {
        if (mine === seq.current && got.ok) setSet(profileSetOf(got.value));
        return undefined;
      }),
      rethrow,
    );
  }, [commands]);
  useEffect(() => {
    if (live) reload();
    return () => {
      seq.current += 1;
    };
  }, [live, reload]);
  return { set, reload };
}

/** 꼭 기대는 플러그인이 남아 빼기가 거절됐나(`profile.invalid`의 `dependency_disabled`, AGE-33) */
function hasDependents(error: CommandError): boolean {
  return (
    error.kind === "rejected" &&
    (error.profileIssues ?? []).some((issue) => issue.code === "dependency_disabled")
  );
}

/**
 * "프로필에 넣기 ▾" 메뉴. 줄을 누르면 메뉴는 열린 채로 그 프로필의 체크가 바뀐다.
 * `label`을 주면 단추 글을 바꾼다(오류 알림의 "프로필에서 빼기"). `onRemoved`는 뺀 뒤 불린다
 */
export function ProfilePutMenu(props: {
  readonly name: string;
  readonly title: string;
  readonly load: ProfileSetLoad;
  readonly label?: string | undefined;
  readonly onRemoved?: (() => void) | undefined;
}): ReactNode {
  const commands = useCommands();
  const live = useLinkPhase() === "live";
  const [busy, setBusy] = useState<string | null>(null);
  const { set } = props.load;
  const label = props.label ?? t("desktop.workbench.use.put");

  const flip = (profileId: string): void => {
    const profile = set?.profiles.find((p) => p.id === profileId);
    if (profile === undefined || busy !== null) return;
    const removing = inProfile(profile, props.name);
    setBusy(profileId);
    const work = removing
      ? commands.craftMetrics.removeFromProfile(profile.id, props.name, profile.rev)
      : commands.profileCanvas.put(withPlugin(profile, props.name), profile.rev);
    detach(
      work.then((done) => {
        setBusy(null);
        props.load.reload();
        if (!done.ok) {
          toast({
            tone: "danger",
            title: t(
              removing
                ? hasDependents(done.error)
                  ? "desktop.workbench.use.removeDependents"
                  : "desktop.workbench.use.removeFailed"
                : "desktop.workbench.use.putFailed",
              { name: props.title, profile: profileTitleOf(profile.id, profile.title) },
            ),
          });
          return undefined;
        }
        if (removing) props.onRemoved?.();
        return undefined;
      }),
      rethrow,
    );
  };

  return (
    <Menu
      size="sm"
      align="end"
      aria-label={t("desktop.workbench.use.menu", { name: props.title })}
      trigger={
        <Button
          size="xs"
          variant="outline"
          disabled={!live || set === null}
          iconEnd={<ChevronDown aria-hidden />}
        >
          {label}
        </Button>
      }
    >
      {set === null || set.profiles.length === 0 ? (
        <MenuItem disabled>{t("desktop.workbench.use.noProfiles")}</MenuItem>
      ) : (
        set.profiles.map((profile) => {
          const checked = inProfile(profile, props.name);
          return (
            <MenuItem
              key={profile.id}
              role="menuitemcheckbox"
              selected={checked}
              disabled={busy !== null}
              icon={checked ? <Check /> : <span className="size-4" />}
              onSelect={(event) => {
                event.preventDefault();
                flip(profile.id);
              }}
            >
              {profileTitleOf(profile.id, profile.title)}
            </MenuItem>
          );
        })
      )}
    </Menu>
  );
}
