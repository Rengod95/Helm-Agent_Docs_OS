import {
  Button,
  Dialog,
  DialogAction,
  DialogClose,
  Menu,
  MenuHeading,
  MenuItem,
  MenuSeparator,
  toast,
} from "@caustic/react";
import { ArrowRight, Check, Compass, Layers, RotateCcw } from "@caustic/react/icons";
import { profileFailureOf } from "@fresnel/client/workbench";
import { t } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { PermissionChange, ProfileDefaultResetResult } from "@fresnel/contracts/wire";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAppliedProfile, useThread } from "../../state/engine/index.ts";
import { useCommands } from "../commands.ts";
import { COMPOSER_CHIP_CLASS, MenuText } from "../composer-chips.tsx";
import { InfoTip } from "../craft/info-tip.tsx";
import { ProblemLine } from "../pages/shared/problem-state.tsx";
import { profileFailureText } from "../workbench/profile-text.ts";
import {
  DEFAULT_PROFILE_ID,
  profileChipViewOf,
  profileMenuOf,
  startDriveBlockOf,
  startDriveBlockText,
  type ProfileChipView,
  type StartDriveBlock,
} from "./profile-chip-model.ts";
import { reloadProfiles, useProfiles, type ProfilesRead } from "./profile-listing.ts";
import { permissionModeNameOf } from "./turn-model.ts";

// 입력창 프로필 칩(lcM6a, L4 desktop-ux §6.6.1, craft-flows T1).
// 칩은 입력창 아래 줄 왼쪽, 첨부(+) 뒤에 선다. 모양은 다른 칩(권한 모드·모델)과 같은 sm ghost다(높이 28, 좌우 8, 아이콘 14).
// - 닫힘: 겹친 층 아이콘 + 프로필 이름. 스타트 Drive가 있으면 나침반을 붙인다(시작할 수 없으면 경고색).
// - 바꾼 직후: "리뷰 · 다음 단계부터"(단계 경계 전), 적용되면 몇 초 "리뷰(으)로 바뀜".
// - 열림: 맨 위 탈출구(기본 프로필로 전환 / 기본 프로필 되돌리기), 구분선, 프로필 목록(라디오). 도움말은 머리의 정보 아이콘 뒤.
// 권한이 바뀌는 전환은 경고 줄로 입력창 위에 보인다(숨기지 않는다).

/** "바뀜" 표시를 두는 시간 */
const CHANGED_MS = 4000;

/** 칩·경고 줄·스타트 Drive 안내가 같이 쓰는 값 */
export type ProfileChipState = {
  readonly view: ProfileChipView;
  readonly read: ProfilesRead;
  readonly changed: string | null;
  readonly permission: PermissionChange | null;
  readonly startDrive: { readonly plugin: string; readonly block: StartDriveBlock } | null;
  readonly recentId: string | null;
  readonly offline: boolean;
  readonly choose: (id: string) => void;
  readonly onOpen: () => void;
  readonly resetPreview: () => void;
  /** 기본 프로필 되돌리기의 미리 보기. 확인 상자가 열려 있는 동안만 값이 있다 */
  readonly resetOffer: ProfileDefaultResetResult | null;
  readonly closeReset: () => void;
};

/**
 * 스타트 Drive를 시작할 수 있는지 `profile.preview { id, threadId }`로 본다. 프로필이 바뀌거나 확장 목록이 바뀌면 다시 본다.
 * 읽지 못하면 모른다(null)로 두고 경고하지 않는다
 */
function useStartDriveBlock(
  threadId: ThreadId,
  profileId: string,
  plugin: string | null,
  live: boolean,
): { readonly plugin: string; readonly block: StartDriveBlock } | null {
  const commands = useCommands();
  const [found, setFound] = useState<{
    readonly key: string;
    readonly block: StartDriveBlock | null;
  } | null>(null);
  const key = `${threadId}\n${profileId}\n${plugin ?? ""}`;
  useEffect(() => {
    if (plugin === null || !live) return undefined;
    let active = true;
    const check = async (): Promise<void> => {
      const got = await commands.workbench.previewProfile(profileId, threadId);
      if (!active || !got.ok) return;
      setFound({ key, block: startDriveBlockOf(got.value.issues, plugin) });
    };
    detach(check(), rethrow);
    const off = commands.workbench.onChanged(() => {
      detach(check(), rethrow);
    });
    return () => {
      active = false;
      off();
    };
  }, [commands, key, live, plugin, profileId, threadId]);
  if (plugin === null || found === null || found.key !== key || found.block === null) return null;
  return { plugin, block: found.block };
}

/** 칩의 상태와 동작. 입력창이 한 번 부르고 칩·경고 줄에 나눠 준다 */
export function useProfileChip(
  threadId: ThreadId,
  onError: (text: string) => void,
): ProfileChipState {
  const commands = useCommands();
  const read = useProfiles();
  const offline = read.kind === "offline";
  const applied = useAppliedProfile(threadId);
  const summary = useThread(threadId);
  const assigned = summary?.profileId ?? null;
  // 보낸 요청과 그때의 대화 요약 값. 요약 값이 바뀌면(요청이 들어왔거나 다른 곳에서 바뀜) 요청은 끝난 것이다
  const [requested, setRequested] = useState<{
    readonly id: string;
    readonly base: string | null;
  } | null>(null);
  const requestedLive =
    requested !== null && requested.base === assigned && requested.id !== assigned
      ? requested.id
      : null;
  const [permission, setPermission] = useState<{
    readonly target: string;
    readonly change: PermissionChange;
  } | null>(null);
  const [recentId, setRecentId] = useState<string | null>(null);
  const [changed, setChanged] = useState<string | null>(null);
  const view = profileChipViewOf({
    applied: applied?.profileId ?? null,
    assigned,
    requested: requestedLive,
    read,
  });
  // 단계 경계에서 실제로 바뀌면 몇 초 "바뀜"을 보이고, 권한 경고도 내린다
  const lastApplied = useRef(applied?.profileId ?? null);
  useEffect(() => {
    const now = applied?.profileId ?? null;
    const before = lastApplied.current;
    lastApplied.current = now;
    if (now === null || before === null || now === before) return undefined;
    setChanged(now);
    setPermission((current) => (current?.target === now ? null : current));
    const timer = setTimeout(() => {
      setChanged(null);
    }, CHANGED_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [applied?.profileId]);
  const startDrive = useStartDriveBlock(
    threadId,
    view.pending?.id ?? view.currentId,
    view.startDrive,
    !offline,
  );
  const choose = (id: string): void => {
    setRequested({ id, base: assigned });
    setChanged(null);
    detach(
      commands.workbench.applyProfile(id, threadId).then((done) => {
        if (!done.ok) {
          setRequested(null);
          const code = done.error.kind === "rejected" ? done.error.code : null;
          onError(t(profileFailureText(profileFailureOf(code))));
          return undefined;
        }
        const change = done.value.preview.permission;
        setPermission(change === undefined ? null : { target: id, change });
        return undefined;
      }),
      rethrow,
    );
  };
  const onOpen = (): void => {
    reloadProfiles(commands);
    detach(
      commands.workbench.defaultProfileFor(summary?.workspace ?? null).then((got) => {
        setRecentId(got.ok ? got.value : null);
        return undefined;
      }),
      rethrow,
    );
  };
  const [resetOffer, setResetOffer] = useState<ProfileDefaultResetResult | null>(null);
  const resetPreview = (): void => {
    detach(
      commands.workbench.resetDefaultProfile(true).then((got) => {
        if (!got.ok) {
          onError(t("desktop.profileChip.resetFailed"));
          return undefined;
        }
        setResetOffer(got.value);
        return undefined;
      }),
      rethrow,
    );
  };
  return {
    view,
    read,
    changed: changed === view.currentId && view.pending === null ? changed : null,
    permission:
      permission !== null && view.pending?.id === permission.target ? permission.change : null,
    startDrive,
    recentId,
    offline,
    choose,
    onOpen,
    resetPreview,
    resetOffer,
    closeReset: () => {
      setResetOffer(null);
    },
  };
}

/** 칩 아래 메뉴의 프로필 목록 부분. 읽는 중·실패·빈 목록은 누를 수 없는 줄 하나다 */
export function ProfileRows(props: { readonly state: ProfileChipState }): ReactNode {
  const { state } = props;
  const commands = useCommands();
  if (state.read.kind === "loading" || state.read.kind === "offline") {
    return (
      <MenuItem disabled>
        {state.read.kind === "offline"
          ? t("desktop.profileChip.offline")
          : t("desktop.profileChip.loading")}
      </MenuItem>
    );
  }
  if (state.read.kind === "failed") {
    return (
      <>
        <p className="m-0 px-2 py-1.5 text-ui-sm text-text-secondary">
          {t("desktop.profileChip.loadFailed")}
        </p>
        <MenuItem
          icon={<RotateCcw aria-hidden />}
          onSelect={(event) => {
            event.preventDefault();
            reloadProfiles(commands);
          }}
        >
          {t("desktop.profileChip.retry")}
        </MenuItem>
      </>
    );
  }
  const target = state.view.pending?.id ?? state.view.currentId;
  const rows = profileMenuOf(state.read.profiles, target, state.recentId);
  if (rows.length === 0) return <MenuItem disabled>{t("desktop.profileChip.empty")}</MenuItem>;
  return rows.map((row) => {
    const hints = [
      row.startDrive === null
        ? null
        : t("desktop.profileChip.startDrive", { plugin: row.startDrive }),
      row.permission === null ? null : permissionModeNameOf(row.permission),
      row.recent ? t("desktop.profileChip.recent") : null,
    ].filter((hint) => hint !== null);
    return (
      <MenuItem
        key={row.id}
        role="menuitemradio"
        selected={row.selected}
        className="h-auto min-h-control-md items-start py-1.5 [&>[data-slot=menu-icon]]:pt-0.5 [&>[data-slot=menu-label]]:whitespace-normal"
        icon={row.startDrive === null ? <Layers aria-hidden /> : <Compass aria-hidden />}
        end={row.selected ? <Check aria-hidden className="size-3.5" /> : undefined}
        data-profile-row={row.id}
        onSelect={() => {
          if (!row.selected) state.choose(row.id);
        }}
      >
        {hints.length === 0 ? (
          <span className="truncate">{row.title}</span>
        ) : (
          <MenuText title={row.title} hint={hints.join(" · ")} />
        )}
      </MenuItem>
    );
  });
}

/** 되돌리기 확인 상자의 줄. 바뀌는 것이 없으면 그 사실 한 줄이다 */
export function resetLinesOf(offer: ProfileDefaultResetResult): readonly string[] {
  if (!offer.changed.plugins && !offer.changed.settings)
    return [t("desktop.profileChip.resetNone")];
  return [
    t("desktop.profileChip.resetBody", { threads: offer.threadsUsing }),
    offer.changed.plugins ? t("desktop.profileChip.resetPlugins") : null,
    offer.changed.settings ? t("desktop.profileChip.resetSettings") : null,
  ].filter((line) => line !== null);
}

/** 기본 프로필 되돌리기 확인. 미리 본 바뀜(플러그인·설정, 따라가는 대화 수)을 보이고 확인을 받는다 */
function ResetDialog(props: {
  readonly offer: ProfileDefaultResetResult | null;
  readonly onClose: () => void;
}): ReactNode {
  const commands = useCommands();
  const { offer } = props;
  const nothing = offer !== null && !offer.changed.plugins && !offer.changed.settings;
  const lines = offer === null ? [] : resetLinesOf(offer);
  return (
    <Dialog
      kind="alert"
      open={offer !== null}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      title={t("desktop.profileChip.resetTitle")}
      description={lines.map((line) => (
        <span key={line} className="block">
          {line}
        </span>
      ))}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" size="sm" autoFocus>
              {t("desktop.profileChip.resetCancel")}
            </Button>
          </DialogClose>
          {nothing ? null : (
            <DialogAction
              onClick={() => {
                detach(
                  commands.workbench.resetDefaultProfile(false).then((done) => {
                    toast(
                      done.ok
                        ? { tone: "success", title: t("desktop.profileChip.resetDone") }
                        : { tone: "danger", title: t("desktop.profileChip.resetFailed") },
                    );
                    return undefined;
                  }),
                  rethrow,
                );
              }}
            >
              {t("desktop.profileChip.resetConfirm")}
            </DialogAction>
          )}
        </>
      }
    />
  );
}

/** 칩 글: 바꿀 것이 있으면 "리뷰 · 다음 단계부터", 막 바뀌었으면 "리뷰(으)로 바뀜", 아니면 이름 */
function chipTextOf(state: ProfileChipState): string {
  if (state.view.pending !== null) {
    return t("desktop.profileChip.pending", { to: state.view.pending.title });
  }
  if (state.changed !== null) return t("desktop.profileChip.changed", { name: state.view.title });
  return state.view.title;
}

function chipLabelOf(state: ProfileChipState): string {
  const { view } = state;
  const base =
    view.pending === null
      ? t("desktop.profileChip.aria", { name: view.title })
      : t("desktop.profileChip.pendingAria", { from: view.title, to: view.pending.title });
  if (state.startDrive !== null) {
    return `${base}, ${t("desktop.profileChip.startDriveOff", { plugin: state.startDrive.plugin })}`;
  }
  if (view.startDrive !== null) {
    return `${base}, ${t("desktop.profileChip.startDriveAria", { plugin: view.startDrive })}`;
  }
  return base;
}

export function ProfileChip(props: {
  readonly state: ProfileChipState;
  readonly disabled: boolean;
}): ReactNode {
  const { state } = props;
  const { view } = state;
  const moving = view.pending !== null;
  return (
    <>
      <Menu
        size="sm"
        side="top"
        align="start"
        aria-label={t("desktop.profileChip.heading")}
        className="w-80"
        onOpenChange={(open) => {
          if (open) state.onOpen();
        }}
        trigger={
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={props.disabled || state.offline}
            title={state.offline ? t("desktop.profileChip.offline") : undefined}
            data-composer-chip="profile"
            data-state={moving ? "pending" : state.changed === null ? "ready" : "changed"}
            aria-label={chipLabelOf(state)}
            className={`${COMPOSER_CHIP_CLASS} ${moving ? "text-text-secondary" : ""}`}
          >
            {moving ? <ArrowRight aria-hidden /> : <Layers aria-hidden />}
            <span className="truncate">{chipTextOf(state)}</span>
            {view.startDrive === null ? null : (
              <Compass
                aria-hidden
                data-slot="start-drive-mark"
                className={state.startDrive === null ? "text-accent-text" : "text-warning-text"}
              />
            )}
          </Button>
        }
      >
        <MenuHeading className="flex items-center gap-1">
          {t("desktop.profileChip.heading")}
          <InfoTip
            text={t("desktop.profileChip.info")}
            label={t("desktop.profileChip.infoLabel")}
          />
        </MenuHeading>
        {view.escape === "switch" ? (
          <MenuItem
            icon={<RotateCcw aria-hidden />}
            data-profile-escape="switch"
            onSelect={() => {
              state.choose(DEFAULT_PROFILE_ID);
            }}
          >
            {t("desktop.profileChip.escape")}
          </MenuItem>
        ) : (
          <MenuItem
            icon={<RotateCcw aria-hidden />}
            data-profile-escape="reset"
            disabled={state.offline}
            onSelect={() => {
              state.resetPreview();
            }}
          >
            {t("desktop.profileChip.reset")}
          </MenuItem>
        )}
        <MenuSeparator />
        <ProfileRows state={state} />
      </Menu>
      <ResetDialog offer={state.resetOffer} onClose={state.closeReset} />
    </>
  );
}

/**
 * 입력창 위 경고 줄: 다음 단계부터 권한이 바뀌는 전환, 시작할 수 없는 스타트 Drive. 경고는 정보 아이콘 뒤에 숨기지 않는다
 */
export function ProfileNotices(props: { readonly state: ProfileChipState }): ReactNode {
  const { state } = props;
  return (
    <>
      {state.permission === null ? null : (
        <div data-slot="profile-permission-notice">
          <ProblemLine tone="warning" role="note">
            {t("desktop.profileChip.permission", {
              from: permissionModeNameOf(state.permission.from),
              to: permissionModeNameOf(state.permission.to),
            })}
          </ProblemLine>
        </div>
      )}
      {state.startDrive === null ? null : (
        <div data-slot="start-drive-notice">
          <ProblemLine tone="warning" role="status">
            {t("desktop.startDrive.unavailable", { plugin: state.startDrive.plugin })} ·{" "}
            {t(startDriveBlockText(state.startDrive.block))}. {t("desktop.startDrive.fallback")}
          </ProblemLine>
        </div>
      )}
    </>
  );
}
