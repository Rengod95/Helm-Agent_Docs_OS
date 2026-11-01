import { t, type MessageId } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import { useState, type ReactNode } from "react";
import { useLocked, type LockedThread } from "../state/ui/index.ts";
import { useCommands } from "./commands.ts";

// `thread.locked`(3002) 대화 상자(G2-09, L4.desktop.spec §5). 다른 프로세스(CLI 등)가 이 대화의 쓰기 소유를 쥐고 있을 때
// 관찰만 하거나 분기해 이어 쓰는 길을 묻는다. 위임은 서비스 공급원에서만 있어 이 화면에는 없다.

const OWNER_ID: ReadonlyMap<string, MessageId> = new Map<string, MessageId>([
  ["cli", "desktop.lockedDialog.owner.cli"],
  ["desktop", "desktop.lockedDialog.owner.desktop"],
]);

export function ownerText(ownerKind: string): string {
  const id = OWNER_ID.get(ownerKind);
  return id === undefined ? t("desktop.lockedDialog.owner.unknown") : t(id);
}

export function LockedDialog(): ReactNode {
  const locked = useLocked();
  if (locked === null) return null;
  return <LockedDialogBody locked={locked} />;
}

/** 상태 없이 props만 그리는 부분(서버 렌더 시험용)에 `failed`를 더한 내부 부품 */
function LockedDialogBody(props: { readonly locked: LockedThread }): ReactNode {
  const commands = useCommands();
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const { locked } = props;
  const run = (work: Promise<{ readonly ok: boolean }>): void => {
    setBusy(true);
    setFailed(false);
    detach(
      work.then((result) => {
        setBusy(false);
        if (!result.ok) setFailed(true);
        return undefined;
      }),
      rethrow,
    );
  };
  return (
    <LockedDialogView
      locked={locked}
      busy={busy}
      failed={failed}
      onObserve={() => {
        run(commands.observeThread(locked.threadId));
      }}
      onFork={() => {
        run(commands.forkThread(locked.threadId));
      }}
      onClose={() => {
        commands.dismissLocked();
      }}
    />
  );
}

export function LockedDialogView(props: {
  readonly locked: LockedThread;
  readonly busy: boolean;
  readonly failed: boolean;
  readonly onObserve: () => void;
  readonly onFork: () => void;
  readonly onClose: () => void;
}): ReactNode {
  const { locked, busy } = props;
  return (
    <div className="dialog-backdrop">
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={t("desktop.lockedDialog.inUse")}
      >
        <h2>{t("desktop.lockedDialog.heading", { owner: ownerText(locked.ownerKind) })}</h2>
        <p className="dim">{t("desktop.lockedDialog.hint")}</p>
        <div className="approval-actions">
          {locked.options.includes("observe") ? (
            <button type="button" disabled={busy} onClick={props.onObserve}>
              {t("desktop.lockedDialog.observe.button")}
            </button>
          ) : null}
          {locked.options.includes("fork") ? (
            <button type="button" className="primary" disabled={busy} onClick={props.onFork}>
              {t("desktop.lockedDialog.fork.button")}
            </button>
          ) : null}
          <button type="button" disabled={busy} onClick={props.onClose}>
            {t("desktop.lockedDialog.close.button")}
          </button>
        </div>
        {props.failed ? (
          <div className="error" role="alert">
            {t("desktop.lockedDialog.failed")}
          </div>
        ) : null}
      </div>
    </div>
  );
}
