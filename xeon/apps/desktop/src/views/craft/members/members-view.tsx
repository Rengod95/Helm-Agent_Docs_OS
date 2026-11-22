// 플러그인 상세 "구성원" 탭의 그림(m6Mb, AGE-33). 한 물음에 답한다: "이 플러그인은 어떤 구성원으로 되어 있고 각각 무엇을 하나".
// 두 배치를 한 빌드에서 견준다(개발 빌드의 고르개, `members-dev.tsx`). 배포 판은 `list`다.
//   list: 구성원 하나가 줄 하나(대화 목록 줄과 같은 높이 32). 순서 번호, 끌기 손잡이, 종류 그림, 이름, 하는 일, 걸린 블록, 메뉴가 한 줄에 선다.
//   split: 왼쪽은 이름만 든 목록, 오른쪽은 고른 구성원 하나의 자세히(하는 일, 언제, 블록, 동작).
// 종류 색은 리뷰 화면의 종류 토큰(`review.css`의 `--rv-<종류>`)을 그대로 쓴다: 바깥을 `rv-root`로 감싸 그 변수를 받는다.
// 순서 바꾸기: 손잡이를 끌거나, 손잡이에서 스페이스로 집고 ↑·↓(Home·End)로 옮긴 뒤 스페이스·Enter로 놓는다(Esc는 취소).
// 줄에 초점이 있으면 Alt+↑·↓로 바로 옮긴다. 편집은 바로 원본 폴더에 쓰이고, 리뷰에서 승인하기 전에는 승인본이 그대로 돈다.
import { t, type MessageId } from "@fresnel/client/i18n";
import {
  Alert,
  Button,
  cn,
  Dialog,
  DialogAction,
  DialogClose,
  IconButton,
  Input,
  listNavigationLabel,
  listNavigationLink,
  Menu,
  MenuItem,
  MenuSeparator,
  SegmentedControl,
  SegmentedControlItem,
  Skeleton,
} from "@caustic/react";
import {
  ArrowDown,
  ArrowUp,
  Ellipsis,
  GripVertical,
  Lock,
  Pencil,
  Plus,
  Trash2,
} from "@caustic/react/icons";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import type { MemberInfo, MemberOp, PluginMode } from "@fresnel/contracts/services";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { SIDE_ROW } from "../../side-row.ts";
import { InfoTip } from "../info-tip.tsx";
import { KindGlyph, KindTile } from "../review/review-glyphs.tsx";
import { Chip, NoticeCard, NoticeLine } from "../review/review-parts.tsx";
import {
  ADD_MODES,
  driveAllowedOf,
  idProblemOf,
  keyMoveOf,
  LOCK_TEXT,
  MEMBER_LIMIT,
  memberRowsOf,
  movedOrder,
  sendStateOf,
  type MemberRow,
  type SendState,
} from "./members-model.ts";
import type { MembersData } from "./members-source.ts";

export type MembersLayout = "list" | "split";

/** 블록 칩은 줄에서 둘까지, 나머지는 수로 */
const BLOCKS_SHOWN = 2;

const MODE_WORD: Readonly<Record<PluginMode, MessageId>> = {
  hook: "desktop.craft.review.kind.hook",
  inject: "desktop.craft.review.kind.inject",
  drive: "desktop.craft.review.kind.drive",
};

// ── 편집 상태 ──────────────────────────────────────────────────────────

/** 집어 든 구성원: 원래 자리와 지금 놓일 자리. `pointer`는 끌기, `key`는 키보드로 집은 것이다 */
interface Lift {
  readonly id: string;
  readonly from: number;
  readonly to: number;
  readonly by: "pointer" | "key";
}

type Notice =
  | { readonly kind: "kept"; readonly files: readonly string[] }
  | { readonly kind: "failed"; readonly text: MessageId }
  | { readonly kind: "sent" };

interface Editor {
  readonly busy: boolean;
  readonly adding: boolean;
  readonly renaming: string | null;
  readonly removing: MemberRow | null;
  readonly lift: Lift | null;
  readonly notice: Notice | null;
  /** 낭독기에 알릴 말(옮김, 집음) */
  readonly spoken: string;
  readonly setAdding: (on: boolean) => void;
  readonly setRenaming: (id: string | null) => void;
  readonly setRemoving: (row: MemberRow | null) => void;
  readonly setLift: (lift: Lift | null) => void;
  readonly speak: (text: string) => void;
  readonly run: (ops: readonly MemberOp[]) => Promise<boolean>;
  readonly send: () => void;
  readonly clearNotice: () => void;
}

function useEditor(data: MembersData): Editor {
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [removing, setRemoving] = useState<MemberRow | null>(null);
  const [lift, setLift] = useState<Lift | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [spoken, speak] = useState("");
  const { edit, send: sendData } = data;
  const run = useCallback(
    async (ops: readonly MemberOp[]): Promise<boolean> => {
      if (ops.length === 0) return true;
      setBusy(true);
      const done = await edit(ops);
      setBusy(false);
      if (!done.ok) {
        setNotice({ kind: "failed", text: done.text });
        return false;
      }
      setNotice(done.kept.length > 0 ? { kind: "kept", files: done.kept } : null);
      return true;
    },
    [edit],
  );
  const send = useCallback(() => {
    const go = async (): Promise<void> => {
      setBusy(true);
      const done = await sendData();
      setBusy(false);
      setNotice(done.ok ? { kind: "sent" } : { kind: "failed", text: done.text });
    };
    detach(go(), rethrow);
  }, [sendData]);
  return {
    busy,
    adding,
    renaming,
    removing,
    lift,
    notice,
    spoken,
    setAdding,
    setRenaming,
    setRemoving,
    setLift,
    speak,
    run,
    send,
    clearNotice: () => {
      setNotice(null);
    },
  };
}

// ── 줄의 조각 ──────────────────────────────────────────────────────────

/** 종류 그림. 선언한 일이 없으면 같은 너비의 빈자리다(이름 줄을 맞춘다): Inject와 도구는 구성원 단위로 오지 않아 지어내지 않는다 */
function KindTiles(props: { readonly row: MemberRow }): ReactNode {
  if (props.row.kinds.length === 0) {
    return <span aria-hidden="true" className="size-4 shrink-0" />;
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5">
      {props.row.kinds.map((kind) => (
        <KindTile key={kind} kind={kind} size={16} />
      ))}
    </span>
  );
}

/** 하는 일의 말: Hook이면 걸린 자리, Drive면 "턴을 이끌어요", 둘 다 없으면 그렇다고. 항목은 간격으로 나눈다(DP-226) */
function doesWordsOf(row: MemberRow): readonly string[] {
  const words: string[] = [];
  if (row.kinds.includes("drive")) words.push(t("desktop.craft.members.does.drive"));
  for (const moment of row.moments) words.push(t(moment));
  if (row.otherHooks > 0) {
    words.push(t("desktop.craft.members.does.otherHooks", { count: row.otherHooks }));
  }
  if (words.length === 0) words.push(t("desktop.craft.members.does.none"));
  return words;
}

function Does(props: { readonly row: MemberRow }): ReactNode {
  return (
    <span className="flex min-w-0 items-center gap-3 overflow-hidden text-ui-sm text-text-tertiary">
      {doesWordsOf(props.row).map((word) => (
        <span key={word} className="shrink-0 whitespace-nowrap">
          {word}
        </span>
      ))}
    </span>
  );
}

function BlockChips(props: { readonly row: MemberRow }): ReactNode {
  const { blocks } = props.row;
  if (blocks.length === 0) return null;
  const shown = blocks.slice(0, BLOCKS_SHOWN);
  const rest = blocks.length - shown.length;
  return (
    <span
      className="flex shrink-0 items-center gap-1"
      aria-label={t("desktop.craft.members.blocks", { count: blocks.length })}
    >
      {shown.map((b) => (
        <Chip key={b.id}>{b.title}</Chip>
      ))}
      {rest > 0 && (
        <Chip
          title={blocks
            .slice(BLOCKS_SHOWN)
            .map((b) => b.title)
            .join("\n")}
        >{`+${rest}`}</Chip>
      )}
    </span>
  );
}

function MemberName(props: { readonly row: MemberRow; readonly strong?: boolean }): ReactNode {
  const { row } = props;
  return (
    <span className="flex min-w-0 items-baseline gap-2">
      <span
        className={cn(
          "min-w-0 truncate text-ui-md text-text-primary",
          props.strong === false ? "font-normal" : "font-medium",
        )}
      >
        {row.name}
      </span>
      {row.hasTitle && (
        <span className="shrink-0 font-mono text-mono-sm text-text-tertiary">{row.id}</span>
      )}
    </span>
  );
}

/** 줄 메뉴: 이름 바꾸기, 위로, 아래로, 빼기. 블록이 쓰는 구성원은 뺄 수 없다(엔진이 거절한다) */
function RowMenu(props: {
  readonly row: MemberRow;
  readonly index: number;
  readonly count: number;
  readonly editor: Editor;
  readonly onMove: (to: number) => void;
}): ReactNode {
  const { row, index, count, editor } = props;
  const blocked = row.blocks.length > 0;
  return (
    <Menu
      size="sm"
      align="end"
      aria-label={t("desktop.craft.members.menu", { name: row.name })}
      trigger={
        <IconButton
          size="sm"
          variant="ghost"
          disabled={editor.busy}
          label={t("desktop.craft.members.menu", { name: row.name })}
        >
          <Ellipsis aria-hidden />
        </IconButton>
      }
    >
      <MenuItem
        icon={<Pencil aria-hidden />}
        onSelect={() => {
          editor.setRenaming(row.id);
        }}
      >
        {t("desktop.craft.members.rename")}
      </MenuItem>
      <MenuItem
        icon={<ArrowUp aria-hidden />}
        disabled={index === 0}
        end="⌥↑"
        onSelect={() => {
          props.onMove(index - 1);
        }}
      >
        {t("desktop.craft.members.moveUp")}
      </MenuItem>
      <MenuItem
        icon={<ArrowDown aria-hidden />}
        disabled={index === count - 1}
        end="⌥↓"
        onSelect={() => {
          props.onMove(index + 1);
        }}
      >
        {t("desktop.craft.members.moveDown")}
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        icon={<Trash2 aria-hidden />}
        tone={blocked ? "neutral" : "danger"}
        disabled={blocked}
        end={blocked ? t("desktop.craft.members.remove.blockedShort") : undefined}
        onSelect={() => {
          editor.setRemoving(row);
        }}
      >
        {t("desktop.craft.members.remove")}
      </MenuItem>
    </Menu>
  );
}

// ── 끌기 ───────────────────────────────────────────────────────────────

/**
 * 손잡이 끌기. 누른 때 줄들의 자리를 재어 두고, 손가락이 든 칸이 놓일 자리다(줄 높이가 같아 칸으로 가른다).
 * 5px 넘게 움직여야 끌기로 본다. 놓으면 `onDrop(from, to)` 한 번
 */
function useHandleDrag(
  listRef: RefObject<HTMLOListElement | null>,
  editor: Editor,
  onDrop: (id: string, from: number, to: number) => void,
): (id: string, index: number, e: ReactPointerEvent<HTMLElement>) => void {
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);
  const { setLift } = editor;
  return useCallback(
    (id: string, index: number, e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0 || listRef.current === null) return;
      const rows = [...listRef.current.querySelectorAll<HTMLElement>("[data-member-row]")];
      const slots = rows.map((r) => r.getBoundingClientRect());
      const startY = e.clientY;
      let moved = false;
      let to = index;
      const slotOf = (y: number): number => {
        const at = slots.findIndex((s) => y < s.bottom);
        return at < 0 ? slots.length - 1 : at;
      };
      const move = (ev: PointerEvent): void => {
        if (!moved && Math.abs(ev.clientY - startY) < 5) return;
        moved = true;
        to = slotOf(ev.clientY);
        setLift({ id, from: index, to, by: "pointer" });
      };
      const end = (): void => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", cancel);
        stop.current = null;
        setLift(null);
        if (moved && to !== index) onDrop(id, index, to);
      };
      const cancel = (): void => {
        moved = false;
        end();
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", cancel);
      stop.current = cancel;
    },
    [listRef, onDrop, setLift],
  );
}

/** 손잡이: 끌기의 시작점이자 키보드로 집는 단추 */
function Handle(props: {
  readonly row: MemberRow;
  readonly index: number;
  readonly count: number;
  readonly lift: Lift | null;
  readonly disabled: boolean;
  readonly describedBy: string;
  readonly onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  readonly onKeyLift: (lift: Lift | null, drop: boolean) => void;
}): ReactNode {
  const { row, index, lift } = props;
  const held = lift !== null && lift.id === row.id && lift.by === "key";
  return (
    <IconButton
      size="xs"
      variant="ghost"
      data-member-handle={row.id}
      label={t("desktop.craft.members.handle", { name: row.name })}
      aria-describedby={props.describedBy}
      aria-pressed={held}
      disabled={props.disabled}
      className={cn(
        "shrink-0 cursor-grab touch-none text-text-tertiary disabled:cursor-default",
        held ? "bg-control-raised text-text-primary" : null,
      )}
      onPointerDown={props.onPointerDown}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          if (held) props.onKeyLift(lift, true);
          else props.onKeyLift({ id: row.id, from: index, to: index, by: "key" }, false);
          return;
        }
        if (held && e.key === "Escape") {
          e.preventDefault();
          props.onKeyLift(null, false);
          return;
        }
        if (!held) return;
        const to = keyMoveOf(e.key, false, true, lift.to, props.count);
        if (to === null) return;
        e.preventDefault();
        props.onKeyLift({ ...lift, to }, false);
      }}
    >
      <GripVertical aria-hidden />
    </IconButton>
  );
}

// ── 더하기·이름 바꾸기 ─────────────────────────────────────────────────

function AddForm(props: {
  readonly existing: readonly string[];
  readonly driveAllowed: boolean;
  readonly busy: boolean;
  readonly onAdd: (id: string, title: string, mode: PluginMode) => void;
  readonly onCancel: () => void;
}): ReactNode {
  const [id, setId] = useState("");
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<PluginMode>("hook");
  const idField = useId();
  const titleField = useId();
  const problem = idProblemOf(id, props.existing);
  const ready = id !== "" && problem === null && !props.busy;
  const submit = (): void => {
    if (ready) props.onAdd(id, title, mode);
  };
  return (
    <form
      data-member-add=""
      aria-label={t("desktop.craft.members.add")}
      className="grid gap-3 rounded-xl p-4 shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)]"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          props.onCancel();
        }
      }}
    >
      <div className="grid gap-1.5">
        <span className="flex items-center gap-1 text-ui-sm text-text-secondary">
          {t("desktop.craft.members.mode")}
          {!props.driveAllowed && <InfoTip text={t("desktop.craft.members.mode.driveLocked")} />}
        </span>
        <SegmentedControl
          size="sm"
          value={mode}
          aria-label={t("desktop.craft.members.mode")}
          onValueChange={(value) => {
            const picked = ADD_MODES.find((m) => m === value);
            if (picked !== undefined) setMode(picked);
          }}
          className="justify-self-start"
        >
          {ADD_MODES.map((m) => (
            <SegmentedControlItem
              key={m}
              value={m}
              disabled={m === "drive" && !props.driveAllowed}
              icon={
                <span className={`rv-kind-${m} rv-kind-text inline-flex`}>
                  <KindGlyph kind={m} size={12} />
                </span>
              }
            >
              {t(MODE_WORD[m])}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label htmlFor={idField} className="grid content-start gap-1.5">
          <span className="text-ui-sm text-text-secondary">{t("desktop.craft.members.id")}</span>
          <Input
            id={idField}
            size="sm"
            autoFocus
            value={id}
            invalid={problem !== null}
            spellCheck={false}
            autoComplete="off"
            placeholder={t("desktop.craft.members.id.placeholder")}
            className="font-mono"
            aria-describedby={problem === null ? undefined : `${idField}-problem`}
            onValueChange={(value) => {
              setId(value.trim());
            }}
          />
          {problem !== null && (
            <span id={`${idField}-problem`} role="alert" className="text-ui-sm text-danger-text">
              {t(problem)}
            </span>
          )}
        </label>
        <label htmlFor={titleField} className="grid content-start gap-1.5">
          <span className="flex items-center gap-1 text-ui-sm text-text-secondary">
            {t("desktop.craft.members.title")}
            <InfoTip text={t("desktop.craft.members.title.help")} />
          </span>
          <Input id={titleField} size="sm" value={title} maxLength={64} onValueChange={setTitle} />
        </label>
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={props.onCancel}>
          {t("desktop.craft.members.cancel")}
        </Button>
        <Button type="submit" size="sm" variant="solid" disabled={!ready}>
          {t("desktop.craft.members.add.confirm")}
        </Button>
      </div>
    </form>
  );
}

function RenameField(props: {
  readonly row: MemberRow;
  readonly existing: readonly string[];
  readonly busy: boolean;
  readonly onSave: (to: string) => void;
  readonly onCancel: () => void;
}): ReactNode {
  const [to, setTo] = useState(props.row.id);
  const others = props.existing.filter((id) => id !== props.row.id);
  const problem = idProblemOf(to, others);
  const ready = to !== "" && to !== props.row.id && problem === null && !props.busy;
  const fieldId = useId();
  return (
    <form
      className="flex min-w-0 flex-1 items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) props.onSave(to);
        else if (to === props.row.id) props.onCancel();
      }}
    >
      <Input
        size="xs"
        autoFocus
        value={to}
        invalid={problem !== null}
        spellCheck={false}
        autoComplete="off"
        aria-label={t("desktop.craft.members.rename.label", { name: props.row.name })}
        aria-describedby={problem === null ? undefined : fieldId}
        className="font-mono"
        containerClassName="w-56"
        onValueChange={(value) => {
          setTo(value.trim());
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            props.onCancel();
          }
        }}
      />
      {problem !== null && (
        <span id={fieldId} role="alert" className="min-w-0 truncate text-ui-sm text-danger-text">
          {t(problem)}
        </span>
      )}
      <span aria-hidden className="flex-1" />
      <Button type="button" size="xs" variant="ghost" onClick={props.onCancel}>
        {t("desktop.craft.members.cancel")}
      </Button>
      <Button type="submit" size="xs" variant="solid" disabled={!ready}>
        {t("desktop.craft.members.rename.save")}
      </Button>
    </form>
  );
}

function RemoveDialog(props: { readonly editor: Editor }): ReactNode {
  const { editor } = props;
  const row = editor.removing;
  return (
    <Dialog
      kind="alert"
      open={row !== null}
      onOpenChange={(open) => {
        if (!open) editor.setRemoving(null);
      }}
      title={row === null ? "" : t("desktop.craft.members.remove.heading", { name: row.name })}
      description={t("desktop.craft.members.remove.body")}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" size="sm" autoFocus>
              {t("desktop.craft.members.cancel")}
            </Button>
          </DialogClose>
          <DialogAction
            disabled={editor.busy}
            onClick={(event) => {
              event.preventDefault();
              if (row === null) return;
              detach(
                editor.run([{ kind: "remove", id: row.id }]).then(() => {
                  editor.setRemoving(null);
                  return undefined;
                }),
                rethrow,
              );
            }}
          >
            {t("desktop.craft.members.remove.confirm")}
          </DialogAction>
        </>
      }
    />
  );
}

// ── 머리와 알림 ────────────────────────────────────────────────────────

function SendNotice(props: {
  readonly state: SendState;
  readonly editable: boolean;
  readonly editor: Editor;
  readonly onOpen: (itemId: string) => void;
}): ReactNode {
  const { state, editor } = props;
  switch (state.kind) {
    case "clean":
      return null;
    case "changed":
      if (!props.editable) return null;
      return (
        <NoticeCard
          tone="info"
          name="members-changed"
          title={t("desktop.craft.members.send.changed")}
          description={t("desktop.craft.members.send.changedBody")}
          actionLabel={t(
            editor.busy ? "desktop.craft.members.send.sending" : "desktop.craft.members.send",
          )}
          onAction={() => {
            if (!editor.busy) editor.send();
          }}
        />
      );
    case "inReview":
      return (
        <NoticeCard
          tone="neutral"
          live={editor.notice?.kind === "sent"}
          name="members-in-review"
          title={t(
            editor.notice?.kind === "sent"
              ? "desktop.craft.members.send.sent"
              : "desktop.craft.members.send.waiting",
          )}
          description={t("desktop.craft.members.send.waitingBody")}
          actionLabel={t("desktop.craft.members.send.open")}
          onAction={() => {
            props.onOpen(state.itemId);
          }}
        />
      );
    default:
      return assertNever(state, "SendNotice");
  }
}

function EditNotice(props: { readonly editor: Editor }): ReactNode {
  const notice = props.editor.notice;
  if (notice === null || notice.kind === "sent") return null;
  if (notice.kind === "failed") {
    return (
      <div role="alert">
        <NoticeLine tone="danger">{t(notice.text)}</NoticeLine>
      </div>
    );
  }
  return (
    <div role="status" className="grid gap-1">
      {notice.files.map((file) => (
        <NoticeLine key={file} tone="info">
          {t("desktop.craft.members.kept", { file })}
        </NoticeLine>
      ))}
    </div>
  );
}

function Header(props: {
  readonly editable: boolean;
  readonly lockText: MessageId | null;
  readonly full: boolean;
  readonly editor: Editor;
}): ReactNode {
  const { editor } = props;
  // 오른쪽 안 여백은 줄의 px-1.5와 같다: 더하기 단추와 줄 메뉴의 오른쪽 끝이 한 세로줄에 선다
  return (
    <div className="flex h-control-sm items-center gap-1 pr-1.5">
      <h3 className="m-0 text-title-3 font-semibold text-text-primary">
        {t("desktop.craft.members.heading")}
      </h3>
      <InfoTip text={t("desktop.craft.members.order.help")} />
      <span aria-hidden className="flex-1" />
      {props.lockText !== null && (
        <span className="inline-flex items-center gap-1 text-ui-sm text-text-tertiary">
          <Lock aria-hidden className="size-icon-sm" />
          {t("desktop.craft.members.readOnly")}
          <InfoTip text={t(props.lockText)} />
        </span>
      )}
      {props.editable && (
        <span className="inline-flex items-center gap-1">
          {props.full && (
            <InfoTip text={t("desktop.craft.members.add.limit", { count: MEMBER_LIMIT })} />
          )}
          <Button
            size="xs"
            variant="ghost"
            disabled={editor.busy || editor.adding || props.full}
            onClick={() => {
              editor.setAdding(true);
            }}
          >
            <Plus aria-hidden />
            {t("desktop.craft.members.add")}
          </Button>
        </span>
      )}
    </div>
  );
}

// ── 배치 ───────────────────────────────────────────────────────────────

interface LayoutProps {
  readonly rows: readonly MemberRow[];
  readonly editable: boolean;
  readonly editor: Editor;
  readonly existing: readonly string[];
  readonly onMove: (id: string, from: number, to: number) => void;
  readonly onRename: (id: string, to: string) => void;
}

/** 집어 든 동안의 보이는 순서(놓기 전 미리 보기) */
function shownRows(rows: readonly MemberRow[], lift: Lift | null): readonly MemberRow[] {
  return lift === null ? rows : movedOrder(rows, lift.from, lift.to);
}

/** 손잡이·Alt+화살표·메뉴가 같이 쓰는 키보드와 끌기 묶음 */
function useReorder(props: LayoutProps, listRef: RefObject<HTMLOListElement | null>) {
  const { editor, rows, onMove } = props;
  const begin = useHandleDrag(listRef, editor, onMove);
  const onKeyLift = (lift: Lift | null, drop: boolean): void => {
    if (drop && lift !== null) {
      const row = rows[lift.from];
      editor.setLift(null);
      if (row !== undefined && lift.to !== lift.from) {
        onMove(lift.id, lift.from, lift.to);
        editor.speak(t("desktop.craft.members.moved", { name: row.name, index: lift.to + 1 }));
      }
      return;
    }
    if (lift === null) {
      editor.setLift(null);
      editor.speak(t("desktop.craft.members.liftCancelled"));
      return;
    }
    const row = rows[lift.from];
    editor.setLift(lift);
    if (row !== undefined) {
      editor.speak(
        lift.to === lift.from && editor.lift === null
          ? t("desktop.craft.members.lifted", { name: row.name })
          : t("desktop.craft.members.liftAt", { index: lift.to + 1, count: rows.length }),
      );
    }
  };
  const onRowKey = (e: ReactKeyboardEvent<HTMLElement>, index: number, row: MemberRow): void => {
    if (!props.editable || editor.busy || e.target !== e.currentTarget) return;
    const to = keyMoveOf(e.key, e.altKey, false, index, rows.length);
    if (to === null) return;
    e.preventDefault();
    onMove(row.id, index, to);
    editor.speak(t("desktop.craft.members.moved", { name: row.name, index: to + 1 }));
  };
  return { begin, onKeyLift, onRowKey };
}

function ListLayout(props: LayoutProps): ReactNode {
  const { editor, editable } = props;
  const listRef = useRef<HTMLOListElement | null>(null);
  const hintId = useId();
  const { begin, onKeyLift, onRowKey } = useReorder(props, listRef);
  const rows = shownRows(props.rows, editor.lift);
  return (
    <>
      <span id={hintId} className="sr-only">
        {t("desktop.craft.members.handle.help")}
      </span>
      <ol
        ref={listRef}
        aria-label={t("desktop.craft.members.heading")}
        className="m-0 grid list-none gap-0.5 p-0"
        data-members-layout="list"
      >
        {rows.map((row, index) => {
          const lifted = editor.lift?.id === row.id;
          const renaming = editor.renaming === row.id;
          return (
            <li
              key={row.id}
              data-member-row={row.id}
              data-lifted={lifted ? "" : undefined}
              tabIndex={editable ? 0 : -1}
              aria-label={row.name}
              className={cn(
                "squircle flex h-control-md min-w-0 items-center gap-2 rounded-lg px-1.5 outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
                lifted
                  ? "bg-control-raised shadow-[inset_0_0_0_1px_var(--cs-color-border-default)]"
                  : "hover:bg-neutral-hover",
              )}
              onKeyDown={(e) => {
                onRowKey(e, index, row);
              }}
            >
              <span
                aria-hidden="true"
                className="w-5 shrink-0 text-end text-ui-sm tabular-nums text-text-tertiary"
              >
                {index + 1}
              </span>
              {editable && (
                <Handle
                  row={row}
                  index={index}
                  count={rows.length}
                  lift={editor.lift}
                  disabled={editor.busy}
                  describedBy={hintId}
                  onPointerDown={(e) => {
                    begin(row.id, index, e);
                  }}
                  onKeyLift={onKeyLift}
                />
              )}
              <KindTiles row={row} />
              {renaming ? (
                <RenameField
                  row={row}
                  existing={props.existing}
                  busy={editor.busy}
                  onSave={(to) => {
                    props.onRename(row.id, to);
                  }}
                  onCancel={() => {
                    editor.setRenaming(null);
                  }}
                />
              ) : (
                <>
                  <span className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="min-w-0 shrink">
                      <MemberName row={row} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <Does row={row} />
                    </span>
                  </span>
                  <BlockChips row={row} />
                  {editable && (
                    <RowMenu
                      row={row}
                      index={index}
                      count={rows.length}
                      editor={editor}
                      onMove={(to) => {
                        props.onMove(row.id, index, to);
                      }}
                    />
                  )}
                </>
              )}
            </li>
          );
        })}
      </ol>
    </>
  );
}

const SPLIT_ROW = cn(
  listNavigationLink({ kind: "sessions", size: "sm" }),
  SIDE_ROW,
  "min-w-0 border-0",
);

function SplitDetail(props: {
  readonly row: MemberRow;
  readonly index: number;
  readonly count: number;
  readonly layout: LayoutProps;
}): ReactNode {
  const { row, layout } = props;
  const { editor, editable } = layout;
  const blocked = row.blocks.length > 0;
  return (
    <section aria-label={row.name} data-member-detail={row.id} className="grid content-start gap-6">
      <div className="grid gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <KindTiles row={row} />
          {editor.renaming === row.id ? (
            <RenameField
              row={row}
              existing={layout.existing}
              busy={editor.busy}
              onSave={(to) => {
                layout.onRename(row.id, to);
              }}
              onCancel={() => {
                editor.setRenaming(null);
              }}
            />
          ) : (
            <h4 className="m-0 min-w-0 truncate text-title-3 font-semibold text-text-primary">
              {row.name}
            </h4>
          )}
        </div>
        {row.hasTitle && (
          <span className="font-mono text-mono-sm text-text-tertiary">{row.id}</span>
        )}
      </div>
      <dl className="m-0 grid grid-cols-[6rem_minmax(0,1fr)] items-baseline gap-x-3 gap-y-2">
        <dt className="text-ui-sm text-text-tertiary">{t("desktop.craft.members.fact.does")}</dt>
        <dd className="m-0 flex flex-wrap gap-x-3 gap-y-1 text-ui text-text-primary">
          {doesWordsOf(row).map((word) => (
            <span key={word}>{word}</span>
          ))}
        </dd>
        <dt className="text-ui-sm text-text-tertiary">{t("desktop.craft.members.fact.order")}</dt>
        <dd className="m-0 text-ui tabular-nums text-text-primary">
          {t("desktop.craft.members.fact.orderValue", {
            index: props.index + 1,
            count: props.count,
          })}
        </dd>
        <dt className="text-ui-sm text-text-tertiary">{t("desktop.craft.members.fact.blocks")}</dt>
        <dd className="m-0 flex flex-wrap gap-1 text-ui text-text-primary">
          {row.blocks.length === 0 ? (
            <span className="text-text-tertiary">{t("desktop.craft.members.fact.noBlocks")}</span>
          ) : (
            row.blocks.map((b) => <Chip key={b.id}>{b.title}</Chip>)
          )}
        </dd>
      </dl>
      {editable && (
        <div className="flex flex-wrap items-center gap-1">
          <Button
            size="xs"
            variant="ghost"
            disabled={editor.busy}
            onClick={() => {
              editor.setRenaming(row.id);
            }}
          >
            <Pencil aria-hidden />
            {t("desktop.craft.members.rename")}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={editor.busy || props.index === 0}
            onClick={() => {
              layout.onMove(row.id, props.index, props.index - 1);
            }}
          >
            <ArrowUp aria-hidden />
            {t("desktop.craft.members.moveUp")}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={editor.busy || props.index === props.count - 1}
            onClick={() => {
              layout.onMove(row.id, props.index, props.index + 1);
            }}
          >
            <ArrowDown aria-hidden />
            {t("desktop.craft.members.moveDown")}
          </Button>
          <span className="inline-flex items-center gap-1">
            <Button
              size="xs"
              variant="ghost"
              disabled={editor.busy || blocked}
              onClick={() => {
                editor.setRemoving(row);
              }}
            >
              <Trash2 aria-hidden />
              {t("desktop.craft.members.remove")}
            </Button>
            {blocked && <InfoTip text={t("desktop.craft.members.remove.blocked")} />}
          </span>
        </div>
      )}
    </section>
  );
}

function SplitLayout(props: LayoutProps & { readonly add: ReactNode }): ReactNode {
  const { editor, editable } = props;
  const listRef = useRef<HTMLOListElement | null>(null);
  const hintId = useId();
  const { begin, onKeyLift, onRowKey } = useReorder(props, listRef);
  const rows = shownRows(props.rows, editor.lift);
  const [picked, setPicked] = useState<string | null>(null);
  const current = rows.find((r) => r.id === picked) ?? rows[0] ?? null;
  const index = current === null ? -1 : rows.indexOf(current);
  return (
    <div
      className="grid grid-cols-[15rem_minmax(0,1fr)] items-start gap-8"
      data-members-layout="split"
    >
      <span id={hintId} className="sr-only">
        {t("desktop.craft.members.handle.help")}
      </span>
      <ol
        ref={listRef}
        aria-label={t("desktop.craft.members.heading")}
        className="m-0 grid list-none gap-0.5 p-0"
      >
        {rows.map((row, i) => {
          const on = current?.id === row.id && !editor.adding;
          const lifted = editor.lift?.id === row.id;
          return (
            <li
              key={row.id}
              data-member-row={row.id}
              data-lifted={lifted ? "" : undefined}
              className="flex min-w-0 items-center gap-1"
            >
              {editable && (
                <Handle
                  row={row}
                  index={i}
                  count={rows.length}
                  lift={editor.lift}
                  disabled={editor.busy}
                  describedBy={hintId}
                  onPointerDown={(e) => {
                    begin(row.id, i, e);
                  }}
                  onKeyLift={onKeyLift}
                />
              )}
              <button
                type="button"
                aria-current={on ? "true" : undefined}
                className={cn(SPLIT_ROW, on || lifted ? null : "bg-transparent")}
                onClick={() => {
                  setPicked(row.id);
                  editor.setAdding(false);
                }}
                onKeyDown={(e) => {
                  onRowKey(e, i, row);
                }}
              >
                <KindTiles row={row} />
                <span className={cn(listNavigationLabel(), "min-w-0 flex-1 truncate")}>
                  {row.name}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {editor.adding
        ? props.add
        : current !== null && (
            <SplitDetail row={current} index={index} count={rows.length} layout={props} />
          )}
    </div>
  );
}

// ── 탭 전체 ────────────────────────────────────────────────────────────

export function MembersView(props: {
  readonly data: MembersData;
  readonly layout: MembersLayout;
}): ReactNode {
  const { data } = props;
  const editor = useEditor(data);
  const { load } = data;
  if (load.status === "loading") {
    return (
      <div className="grid max-w-176 gap-2" aria-busy="true">
        <Skeleton height={24} />
        <Skeleton height={24} />
        <Skeleton height={24} />
      </div>
    );
  }
  if (load.status === "failed") {
    return <Alert tone="danger">{t("desktop.craft.members.load.failed")}</Alert>;
  }
  if (load.status === "offline") {
    return (
      <p className="m-0 text-ui text-text-secondary">{t("desktop.craft.members.load.offline")}</p>
    );
  }
  const editable = load.access.kind === "editable";
  const lockText = load.access.kind === "locked" ? LOCK_TEXT[load.access.reason] : null;
  const rows = memberRowsOf(load.members, data.blockTitles);
  const existing = [data.rootName, ...load.members.map((m: MemberInfo) => m.id)];
  const state = sendStateOf({
    matchesReviewed: load.matchesReviewed,
    pending: load.pending,
    editedSinceSend: data.editedSinceSend,
  });
  const onMove = (id: string, from: number, to: number): void => {
    if (from === to) return;
    detach(
      editor.run([{ kind: "move", id, toIndex: to }]).then(() => undefined),
      rethrow,
    );
  };
  const onRename = (id: string, to: string): void => {
    detach(
      editor.run([{ kind: "rename", id, to }]).then((ok) => {
        if (ok) editor.setRenaming(null);
        return undefined;
      }),
      rethrow,
    );
  };
  const add = (
    <AddForm
      existing={existing}
      driveAllowed={driveAllowedOf(data.rootLayer)}
      busy={editor.busy}
      onCancel={() => {
        editor.setAdding(false);
      }}
      onAdd={(id, title, mode) => {
        const trimmed = title.trim();
        const op: MemberOp = {
          kind: "add",
          id,
          mode,
          ...(trimmed === "" ? {} : { title: trimmed }),
        };
        detach(
          editor.run([op]).then((ok) => {
            if (ok) editor.setAdding(false);
            return undefined;
          }),
          rethrow,
        );
      }}
    />
  );
  const layoutProps: LayoutProps = { rows, editable, editor, existing, onMove, onRename };
  return (
    <div className="rv-root grid max-w-200 content-start gap-4" data-members="">
      <SendNotice state={state} editable={editable} editor={editor} onOpen={data.openReview} />
      <section className="grid gap-3" aria-label={t("desktop.craft.members.heading")}>
        <Header
          editable={editable}
          lockText={lockText}
          full={load.members.length >= MEMBER_LIMIT}
          editor={editor}
        />
        <EditNotice editor={editor} />
        {rows.length === 0 && !editor.adding ? (
          <p className="m-0 text-ui text-text-secondary">{t("desktop.craft.members.empty")}</p>
        ) : props.layout === "split" ? (
          <SplitLayout {...layoutProps} add={add} />
        ) : (
          <ListLayout {...layoutProps} />
        )}
        {props.layout === "list" && editor.adding && add}
        {props.layout === "split" && editor.adding && rows.length === 0 && add}
      </section>
      <span aria-live="polite" className="sr-only">
        {editor.spoken}
      </span>
      <RemoveDialog editor={editor} />
    </div>
  );
}
