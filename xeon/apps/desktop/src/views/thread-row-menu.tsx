import { t, type MessageId } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { WIRE_ERRORS } from "@fresnel/contracts/wire";
import {
  Alert,
  Button,
  Dialog,
  IconButton,
  Input,
  Menu,
  MenuItem,
  MenuSeparator,
  toast,
} from "@caustic/react";
import { Ellipsis } from "@caustic/react/icons";
import { useState, type ReactNode } from "react";
import { useCommands, type CommandError } from "./commands.ts";
import { ThreadExportDialog } from "./thread-export-dialog.tsx";

// 대화 행 ⋯ 메뉴(d01-chat-gaps). 이름 바꾸기, 분기, 대화 요약, 내보내기, 닫기, 지우기. 지우기는 확인 창을 거친다.
// 실행 중인 대화는 지우지 않고 이유만 보인다. 내보내기는 읽기라 실행 중이나 닫힌 대화에서도 된다(O-13 대화 상자).
// 대화 머리의 ⋯(chat-header.tsx)도 이 메뉴를 그대로 쓴다.

const HAS_FORKS = WIRE_ERRORS["thread.hasForks"].code;

/** 지우기 실패 문장. 분기한 대화가 가리키는 대화는 host가 거절한다(`thread.hasForks`) */
export function deleteFailureId(error: CommandError): MessageId {
  if (error.kind === "rejected" && error.code === HAS_FORKS) {
    return "desktop.threads.menu.delete.hasForks";
  }
  if (error.kind === "offline") return "desktop.threads.menu.failed.offline";
  return "desktop.threads.menu.delete.failed";
}

function notifyFailed(): void {
  toast({ tone: "danger", title: t("desktop.threads.menu.failed.action") });
}

const run = (work: Promise<{ readonly ok: boolean }>): void => {
  detach(
    work.then((result) => {
      if (!result.ok) notifyFailed();
      return undefined;
    }),
    rethrow,
  );
};

export function ThreadRowMenu(props: {
  readonly id: ThreadId;
  readonly title: string;
  readonly status: "idle" | "running" | "closed";
  /** 대화 목록 행 뒤에 겹쳐 놓을 때 true. 자리는 바깥 칸이 정한다 */
  readonly bare?: boolean;
}): ReactNode {
  const commands = useCommands();
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const running = props.status === "running";
  const closed = props.status === "closed";

  return (
    <>
      <Menu
        size="sm"
        align="end"
        aria-label={t("desktop.threads.menu.label", { title: props.title })}
        trigger={
          <IconButton
            size={props.bare === true ? "xs" : "sm"}
            variant="ghost"
            label={t("desktop.threads.menu.label", { title: props.title })}
            className={
              props.bare === true
                ? "pointer-events-auto bg-control-raised shadow-[inset_0_0_0_1px_var(--cs-color-control-edge)]"
                : undefined
            }
          >
            <Ellipsis aria-hidden />
          </IconButton>
        }
      >
        <MenuItem
          onSelect={() => {
            setRenaming(true);
          }}
        >
          {t("desktop.threads.menu.rename")}
        </MenuItem>
        <MenuItem
          disabled={running}
          onSelect={() => {
            run(commands.forkThread(props.id));
          }}
        >
          {t("desktop.threads.menu.fork")}
        </MenuItem>
        <MenuItem
          disabled={running || closed}
          onSelect={() => {
            run(commands.compactThread(props.id));
          }}
        >
          {t("desktop.threads.menu.compact")}
        </MenuItem>
        <MenuItem
          onSelect={() => {
            setExporting(true);
          }}
        >
          {t("desktop.threads.menu.export")}
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          disabled={running || closed}
          onSelect={() => {
            run(commands.closeThread(props.id));
          }}
        >
          {t("desktop.threads.menu.close")}
        </MenuItem>
        <MenuItem
          tone="danger"
          onSelect={() => {
            setDeleting(true);
          }}
        >
          {t("desktop.threads.menu.delete")}
        </MenuItem>
      </Menu>
      {renaming ? (
        <RenameDialog
          id={props.id}
          title={props.title}
          onDone={() => {
            setRenaming(false);
          }}
        />
      ) : null}
      {deleting ? (
        <DeleteDialog
          id={props.id}
          title={props.title}
          running={running}
          onDone={() => {
            setDeleting(false);
          }}
        />
      ) : null}
      {exporting ? (
        <ThreadExportDialog
          id={props.id}
          title={props.title}
          onDone={() => {
            setExporting(false);
          }}
        />
      ) : null}
    </>
  );
}

/** 제목은 1~200자다(`thread.rename`). 앞뒤 공백을 뗀 뒤 비어 있으면 저장하지 않는다 */
export function checkTitle(text: string): string | null {
  const title = text.trim();
  return title.length === 0 || title.length > 200 ? null : title;
}

function RenameDialog(props: {
  readonly id: ThreadId;
  readonly title: string;
  readonly onDone: () => void;
}): ReactNode {
  const commands = useCommands();
  const [text, setText] = useState(props.title);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const title = checkTitle(text);
  const save = (): void => {
    if (title === null || busy) return;
    setBusy(true);
    setFailed(false);
    detach(
      commands.renameThread(props.id, title).then((result) => {
        setBusy(false);
        if (result.ok) props.onDone();
        else setFailed(true);
        return undefined;
      }),
      rethrow,
    );
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onDone();
      }}
      size="sm"
      title={t("desktop.threads.menu.rename.title")}
      footer={
        <>
          <Button size="sm" variant="outline" onClick={props.onDone}>
            {t("desktop.threads.menu.cancel")}
          </Button>
          <Button size="sm" variant="solid" disabled={title === null || busy} onClick={save}>
            {t("desktop.threads.menu.rename.save")}
          </Button>
        </>
      }
    >
      <div className="grid gap-2">
        <Input
          size="sm"
          aria-label={t("desktop.threads.menu.rename.title")}
          value={text}
          maxLength={200}
          invalid={title === null}
          onChange={(event) => {
            setText(event.currentTarget.value);
            setFailed(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") save();
          }}
        />
        {failed ? (
          <Alert tone="danger" size="sm" radius="md" role="alert">
            {t("desktop.threads.menu.rename.failed")}
          </Alert>
        ) : null}
      </div>
    </Dialog>
  );
}

function DeleteDialog(props: {
  readonly id: ThreadId;
  readonly title: string;
  readonly running: boolean;
  readonly onDone: () => void;
}): ReactNode {
  const commands = useCommands();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<MessageId | null>(null);
  const confirm = (): void => {
    setBusy(true);
    setFailure(null);
    detach(
      commands.deleteThread(props.id).then((result) => {
        setBusy(false);
        if (result.ok) props.onDone();
        else setFailure(deleteFailureId(result.error));
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
      title={t("desktop.threads.menu.delete.title")}
      description={t(
        props.running ? "desktop.threads.menu.delete.running" : "desktop.threads.menu.delete.body",
        { title: props.title },
      )}
      footer={
        <>
          <Button size="sm" variant="outline" onClick={props.onDone}>
            {t("desktop.threads.menu.cancel")}
          </Button>
          <Button size="sm" variant="solid" disabled={props.running || busy} onClick={confirm}>
            {t("desktop.threads.menu.delete.confirm")}
          </Button>
        </>
      }
    >
      {failure === null ? null : (
        <Alert tone="danger" size="sm" radius="md" role="alert">
          {t(failure)}
        </Alert>
      )}
    </Dialog>
  );
}
