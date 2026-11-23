// 왼쪽 패널 맨 위의 프로필 고르기와 그 옆 + 단추(새 프로필, pfMode2 [결정: 2026-11-23 사용자, AGE-71]), ⋯ 메뉴(craft-flows §6.10, pfCrud):
// 복사, 이름 바꾸기, 지우기. 순서는 고르기, +, ⋯이고 셋 다 높이 control-md(32)이며 사이는 4다. 고르기 상자만 줄어든다.
// 메뉴, 확인 창, 입력은 대화 줄 ⋯ 메뉴(`thread-row-menu.tsx`)와 같은 caustic 부품이다. 이름을 받는 셋(새로, 복사, 이름 바꾸기)은
// 고르기 상자 자리에서 같은 높이(control-md)의 입력으로 바뀐다: Enter는 저장, Esc는 취소, 밖을 누르면 고친 이름을 저장한다.
// 엔진이 거절하면 그 자리 아래에 까닭이 보인다. 지우기는 확인 창을 거치고, 엔진이 지우지 않는 `default`는 메뉴에서 막고 까닭을 적는다.
// 표본 보기(엔진 값이 없음)에서는 메뉴를 두지 않는다.
import { t, type MessageId } from "@fresnel/client/i18n";
import { detach, rethrow, type Result } from "@fresnel/contracts";
import { WIRE_ERRORS } from "@fresnel/contracts/wire";
import {
  Button,
  Dialog,
  DialogClose,
  IconButton,
  Input,
  Menu,
  MenuItem,
  MenuSeparator,
  Select,
  SelectOption,
  toast,
  Tooltip,
} from "@caustic/react";
import { Ellipsis, Plus } from "@caustic/react/icons";
import { useEffect, useId, useRef, useState, type ReactElement } from "react";
import { profileErrorText } from "../../../compose/compose-text.ts";
import { isCommitEnter, useProfileCommands, type CommandError } from "../profile-source.ts";
import { checkProfileTitle } from "./live.ts";
import {
  cloneProfile,
  createProfile,
  deleteProfile,
  renameProfile,
  shownTitleOf,
  titleOf,
  useCanvasStore,
} from "./store.ts";

/** 표본 장면의 이름(개발 빌드의 표본 보기). 엔진 프로필은 저장된 이름을 쓴다 */
const SAMPLE_NAMES: Readonly<Record<string, MessageId>> = {
  dev: "desktop.craft.canvas.cv3.profile.dev",
  empty: "desktop.craft.canvas.cv3.profile.empty",
  scale: "desktop.craft.canvas.sample.scale",
  attach: "desktop.craft.canvas.cv4.profile.attach",
};

export interface ProfileChoice {
  readonly id: string;
  /** 엔진 프로필의 저장된 이름. 표본은 null */
  readonly title: string | null;
}

function choiceName(choice: ProfileChoice): string {
  if (choice.title !== null) return choice.title;
  const key = SAMPLE_NAMES[choice.id];
  return key === undefined ? choice.id : t(key);
}

/** 이름을 받는 일 셋 */
export type NameEdit = "new" | "clone" | "rename";

/** 이름을 받는 입력의 처음 글. 복사는 보이는 이름으로 시작하고(기본 프로필은 "기본"), 이름 고치기는 저장된 제목이다 */
export function startTextOf(edit: NameEdit, name: string, shownName: string): string {
  if (edit === "new") return "";
  if (edit === "clone") {
    return t("desktop.craft.canvas.cv9.profileMenu.cloneTitle", { name: shownName });
  }
  return name;
}

const EDIT_LABEL: Readonly<Record<NameEdit, MessageId>> = {
  new: "desktop.craft.canvas.cv9.profileMenu.name.new",
  clone: "desktop.craft.canvas.cv9.profileMenu.name.clone",
  rename: "desktop.craft.canvas.cv9.profileMenu.name.rename",
};

const BUILTIN_PROTECTED = WIRE_ERRORS["profile.builtinProtected"].code;
const PROFILE_LIMIT = WIRE_ERRORS["profile.limit"].code;
const PROFILE_CONFLICT = WIRE_ERRORS["profile.conflict"].code;

/**
 * 메뉴의 쓰기가 거절된 까닭. 새로 만들기와 복사의 `profile.conflict`는 그 id가 이미 있다는 뜻이고(엔진은 id를 고치지 않는다),
 * 이름 바꾸기의 `profile.conflict`는 그사이 다른 곳에서 바뀌었다는 뜻이다(옛 화면과 같은 글). 나머지는 프로필 저장의 글을 쓴다
 */
export function profileWriteErrorText(error: CommandError, edit: NameEdit | "delete"): MessageId {
  if (error.kind === "rejected") {
    if (error.code === BUILTIN_PROTECTED) return "desktop.craft.canvas.cv9.profileMenu.builtin";
    if (error.code === PROFILE_LIMIT) return "desktop.craft.canvas.cv9.profileMenu.error.limit";
    if (error.code === PROFILE_CONFLICT && (edit === "new" || edit === "clone"))
      return "desktop.craft.canvas.cv9.profileMenu.error.taken";
  }
  return profileErrorText(error);
}

/**
 * 만들기, 복사, 지우기는 보는 프로필을 바꾸고, 캔버스는 프로필마다 새로 그려져 이 머리도 새로 선다. 그 전에 이 표시를 켜 두면
 * 새로 선 머리가 ⋯ 단추로 초점을 가져온다(키보드 사용자가 몸통으로 떨어지지 않는다). 쓰기가 실패하면 끈다
 */
let focusTriggerOnMount = false;

export function ProfileHead(props: {
  readonly current: string;
  readonly choices: readonly ProfileChoice[];
  readonly onProfile: (id: string) => void;
}): ReactElement {
  const store = useCanvasStore();
  const commands = useProfileCommands();
  const [edit, setEdit] = useState<NameEdit | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<MessageId | null>(null);
  const [deleting, setDeleting] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const newRef = useRef<HTMLButtonElement | null>(null);
  const failureId = useId();
  const builtinId = useId();
  const saved = store.live?.saved[props.current];
  // 이름 고치기 입력의 초기값과 비교는 저장된 제목(`name`)을 쓴다. 복사 입력의 초기값과 보이는 글은 `shownName`이다
  const name = titleOf(store, props.current) ?? props.current;
  const shownName = shownTitleOf(store, props.current) ?? props.current;
  // 엔진이 지우지 않는 것: `default`(내장, `builtin`). 숨은 `craft`는 목록에 오지 않는다
  const protectedProfile = saved?.builtin === true || props.current === "default";

  /** 입력을 닫으면 연 단추로 초점을 돌린다(새 프로필은 +, 나머지는 ⋯) */
  const restoreFocus = (from: NameEdit | null = null): void => {
    queueMicrotask(() => {
      (from === "new" ? newRef : triggerRef).current?.focus();
    });
  };
  useEffect(() => {
    if (!focusTriggerOnMount) return;
    focusTriggerOnMount = false;
    triggerRef.current?.focus();
  }, []);
  const start = (next: NameEdit): void => {
    setFailure(null);
    setEdit(next);
    setText(startTextOf(next, name, shownName));
  };
  const stop = (): void => {
    const from = edit;
    setEdit(null);
    setFailure(null);
    restoreFocus(from);
  };
  const commit = (): void => {
    if (edit === null || busy) return;
    const title = checkProfileTitle(text);
    if (title === null) {
      // 빈 이름: 새로 만들기와 복사는 만들지 않고 닫는다. 이름 바꾸기는 그대로 둔다
      stop();
      return;
    }
    if (edit === "rename" && title === name) {
      stop();
      return;
    }
    const kind = edit;
    const work: Promise<Result<unknown, CommandError>> =
      kind === "new"
        ? createProfile(commands, title)
        : kind === "clone"
          ? cloneProfile(commands, props.current, title)
          : renameProfile(commands, props.current, title);
    focusTriggerOnMount = kind !== "rename";
    setBusy(true);
    setFailure(null);
    detach(
      work.then((done) => {
        setBusy(false);
        if (done.ok) stop();
        else {
          focusTriggerOnMount = false;
          setFailure(profileWriteErrorText(done.error, kind));
        }
        return undefined;
      }),
      rethrow,
    );
  };

  return (
    <div className="flex flex-col gap-1.5">
      {edit === null ? (
        <div className="flex items-center gap-1">
          <Select
            size="md"
            aria-label={t("desktop.craft.canvas.cv3.profile")}
            value={props.current}
            onValueChange={(v) => {
              const hit = props.choices.find((c) => c.id === v);
              if (hit !== undefined) props.onProfile(hit.id);
            }}
            className="min-w-0 flex-1"
          >
            {props.choices.map((c) => (
              <SelectOption key={c.id} value={c.id}>
                {choiceName(c)}
              </SelectOption>
            ))}
          </Select>
          {store.live === null ? null : (
            <Tooltip side="bottom" content={t("desktop.craft.canvas.cv9.profileMenu.new")}>
              <IconButton
                ref={newRef}
                size="md"
                variant="ghost"
                data-profile-new=""
                label={t("desktop.craft.canvas.cv9.profileMenu.new")}
                onClick={() => {
                  start("new");
                }}
              >
                <Plus aria-hidden />
              </IconButton>
            </Tooltip>
          )}
          {store.live === null ? null : (
            <Menu
              size="sm"
              align="end"
              aria-label={t("desktop.craft.canvas.cv9.profileMenu.label", { name: shownName })}
              trigger={
                <IconButton
                  ref={triggerRef}
                  size="md"
                  variant="ghost"
                  label={t("desktop.craft.canvas.cv9.profileMenu.label", { name: shownName })}
                >
                  <Ellipsis aria-hidden />
                </IconButton>
              }
            >
              <MenuItem
                disabled={saved === undefined}
                onSelect={() => {
                  start("clone");
                }}
              >
                {t("desktop.craft.canvas.cv9.profileMenu.clone")}
              </MenuItem>
              <MenuItem
                disabled={saved === undefined}
                onSelect={() => {
                  start("rename");
                }}
              >
                {t("desktop.craft.canvas.cv9.profileMenu.rename")}
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                tone="danger"
                disabled={protectedProfile || saved === undefined}
                aria-describedby={protectedProfile ? builtinId : undefined}
                onSelect={() => {
                  setDeleting(true);
                }}
              >
                {t("desktop.craft.canvas.cv9.profileMenu.delete")}
              </MenuItem>
              {protectedProfile ? (
                <p id={builtinId} className="m-0 px-2 pb-1 text-caption text-text-tertiary">
                  {t("desktop.craft.canvas.cv9.profileMenu.builtin")}
                </p>
              ) : null}
            </Menu>
          )}
        </div>
      ) : (
        <Input
          ref={(el) => {
            el?.focus();
          }}
          size="md"
          aria-label={t(EDIT_LABEL[edit])}
          placeholder={t(EDIT_LABEL[edit])}
          value={text}
          maxLength={128}
          disabled={busy}
          invalid={failure !== null}
          aria-describedby={failure === null ? undefined : failureId}
          onValueChange={(value) => {
            setText(value);
            setFailure(null);
          }}
          onKeyDown={(e) => {
            if (isCommitEnter(e)) {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              stop();
            }
          }}
          onBlur={() => {
            if (failure === null) commit();
          }}
        />
      )}
      {failure === null ? null : <Refusal id={failureId} text={t(failure)} />}
      {deleting && saved !== undefined ? (
        <DeleteDialog
          id={props.current}
          name={shownName}
          onDone={() => {
            setDeleting(false);
            restoreFocus();
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * 엔진이 거절한 까닭 한 줄. 표지는 캔버스의 다른 상태 줄과 같은 구슬(`cv6-orb` danger)이고, 구슬은 글의 첫 줄 높이(`1lh`) 안에서
 * 가운데에 선다(글이 두 줄로 넘쳐도 첫 줄에 맞는다)
 */
export function Refusal(props: { readonly id?: string; readonly text: string }): ReactElement {
  return (
    <p
      id={props.id}
      role="alert"
      className="m-0 flex items-start gap-1.5 ps-1 text-ui-sm text-danger-text"
    >
      <span aria-hidden="true" className="inline-flex h-[1lh] shrink-0 items-center">
        <span className="cv6-orb" data-tone="danger" />
      </span>
      <span className="min-w-0">{props.text}</span>
    </p>
  );
}

function DeleteDialog(props: {
  readonly id: string;
  readonly name: string;
  readonly onDone: () => void;
}): ReactElement {
  const commands = useProfileCommands();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<MessageId | null>(null);
  const confirm = (): void => {
    focusTriggerOnMount = true;
    setBusy(true);
    setFailure(null);
    detach(
      deleteProfile(commands, props.id).then((done) => {
        setBusy(false);
        if (!done.ok) {
          focusTriggerOnMount = false;
          setFailure(profileWriteErrorText(done.error, "delete"));
          return undefined;
        }
        toast({
          tone: "success",
          title:
            done.value > 0
              ? t("desktop.craft.canvas.cv9.profileMenu.deleted.moved", { n: done.value })
              : t("desktop.craft.canvas.cv9.profileMenu.deleted"),
        });
        props.onDone();
        return undefined;
      }),
      rethrow,
    );
  };
  return (
    <Dialog
      open
      kind="alert"
      onOpenChange={(open) => {
        if (!open) props.onDone();
      }}
      size="sm"
      title={t("desktop.craft.canvas.cv9.profileMenu.delete.title")}
      description={t("desktop.craft.canvas.cv9.profileMenu.delete.body", { name: props.name })}
      footer={
        <>
          <DialogClose asChild>
            <Button size="sm" variant="outline" autoFocus>
              {t("desktop.craft.canvas.cv9.profileMenu.cancel")}
            </Button>
          </DialogClose>
          <Button size="sm" variant="solid" disabled={busy} onClick={confirm}>
            {t("desktop.craft.canvas.cv9.profileMenu.delete.confirm")}
          </Button>
        </>
      }
    >
      {failure === null ? null : <Refusal text={t(failure)} />}
    </Dialog>
  );
}
