import { Button } from "@caustic/react";
import { Folder, FolderOpen } from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { useState, type ReactNode } from "react";
import { useOpenThreadId, useThread, useThreadSummaries } from "../state/engine/index.ts";
import { useCommands } from "./commands.ts";
import { useFolderPick } from "./folder-pick-context.ts";
import { LensArt } from "./illustrations/lens-art.tsx";
import { useStartNewThread, type NewThreadResult } from "./new-thread-flow.ts";
import { recentWorkspacesOf, type RecentWorkspace } from "./new-thread-model.ts";
import { HostItem, useContextHost } from "./thread-context-bar.tsx";
import { folderNameOf, pathTailOf } from "./thread-context-model.ts";

// 새 대화 화면(DP-70). 제안 칩·인사 문구·그라데이션 원은 없다(2026-11-11 사용자).
// 폴더가 있는 새 대화: 렌즈 그림 아래에 폴더 이름과 경로만 둔다. 동작은 입력창과 그 위 맥락 줄(DP-71)이 한다.
// 폴더가 없는 새 대화: "어디서 작업할까요?" 아래에 최근 폴더, "폴더 열기…", "폴더 없이 시작"을 둔다. 엔진에 대화의 폴더를 바꾸는 명령이
// 없어서, 폴더를 고르면 그 폴더의 새 대화로 간다(보낸 것 없는 빈 대화가 있으면 그리로). "폴더 없이 시작"은 고르기를 접고 입력창에 초점을 준다.

/** "폴더 없이 시작"을 누른 대화. 앱을 다시 켜기 전까지 그 대화에서는 고르기를 접어 둔다 */
const dismissed = new Set<ThreadId>();

/** 고르기 화면에서 무엇을 그릴지. 순수 함수라 시험이 바로 본다 */
export type EmptyThreadView =
  | { readonly kind: "folder"; readonly name: string; readonly path: string }
  | {
      readonly kind: "where";
      readonly recent: readonly RecentWorkspace[];
      /** 폴더 고르기 창이 있는 셸이면 참("폴더 열기…" 단추) */
      readonly canPick: boolean;
    }
  | { readonly kind: "noFolder" };

export function emptyThreadViewOf(input: {
  readonly workspace: string | null;
  readonly dismissed: boolean;
  readonly recent: readonly RecentWorkspace[];
  readonly canPick: boolean;
}): EmptyThreadView {
  const { workspace } = input;
  if (workspace !== null && workspace.trim() !== "") {
    return { kind: "folder", name: folderNameOf(workspace), path: workspace };
  }
  if (input.dismissed) return { kind: "noFolder" };
  return { kind: "where", recent: input.recent, canPick: input.canPick };
}

export function EmptyThread(): ReactNode {
  const threadId = useOpenThreadId();
  if (threadId === null) return null;
  return <EmptyThreadFor key={threadId} threadId={threadId} />;
}

function EmptyThreadFor(props: { readonly threadId: ThreadId }): ReactNode {
  const summary = useThread(props.threadId);
  const workspace = summary?.workspace ?? null;
  const recent = recentWorkspacesOf(useThreadSummaries());
  const folderPick = useFolderPick();
  const [isDismissed, setDismissed] = useState(dismissed.has(props.threadId));
  const view = emptyThreadViewOf({
    workspace,
    dismissed: isDismissed,
    recent,
    canPick: folderPick !== null,
  });
  // 테스트 챗(Craft 창)에는 폴더 고르기가 맞지 않다. 창이 제 안내 한 줄을 그린다(`craft/test-chat/test-chat-window.tsx`)
  if (summary?.craftChat !== undefined) return null;
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      {/* 위:아래 여백을 2:3쯤으로 두어 무게가 가운데보다 조금 위에 온다 */}
      <div className="m-auto flex w-full max-w-120 flex-col items-center px-3 pt-8 pb-16">
        <div className="text-text-tertiary">
          <LensArt />
        </div>
        {view.kind === "folder" ? <FolderHead name={view.name} path={view.path} /> : null}
        {view.kind === "where" ? (
          <Where
            recent={view.recent}
            canPick={view.canPick}
            onNoFolder={() => {
              dismissed.add(props.threadId);
              setDismissed(true);
            }}
          />
        ) : null}
        {view.kind === "noFolder" ? (
          <NoFolder
            onPick={() => {
              dismissed.delete(props.threadId);
              setDismissed(false);
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

function FolderHead(props: { readonly name: string; readonly path: string }): ReactNode {
  return (
    <div className="mt-5 flex w-full min-w-0 flex-col items-center gap-1 text-center">
      <h2 className="m-0 max-w-full truncate text-title-2 text-text-primary">{props.name}</h2>
      <p
        className="m-0 max-w-full truncate font-mono text-footnote text-text-tertiary"
        title={props.path}
      >
        {props.path}
      </p>
    </div>
  );
}

function Where(props: {
  readonly recent: readonly RecentWorkspace[];
  readonly canPick: boolean;
  readonly onNoFolder: () => void;
}): ReactNode {
  const commands = useCommands();
  const folderPick = useFolderPick();
  const startThread = useStartNewThread(folderPick ?? undefined);
  const host = useContextHost();
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // `path`가 undefined면 폴더 고르기 창을 연다
  const start = (key: string, path: string | undefined): void => {
    setBusy(key);
    setFailed(false);
    detach(
      startThread(path).then((result: NewThreadResult) => {
        setBusy(null);
        if (result.kind === "failed" || result.kind === "pickFailed") setFailed(true);
        return undefined;
      }),
      rethrow,
    );
  };
  const hostItem = <HostItem host={host} />;
  return (
    <div className="mt-5 flex w-full flex-col">
      <div className="flex flex-col items-center gap-1 text-center">
        <h2 className="m-0 text-title-2 text-text-primary">
          {t("desktop.newThread.where.heading")}
        </h2>
        <p className="m-0 text-ui text-text-tertiary">{t("desktop.newThread.where.description")}</p>
      </div>
      {props.recent.length === 0 ? null : (
        <section aria-labelledby="new-thread-recent" className="mt-6 flex flex-col gap-1">
          <div className="flex h-6 items-center justify-between px-1 text-text-tertiary">
            <h3 id="new-thread-recent" className="m-0 text-ui font-normal">
              {t("desktop.newThread.where.recent")}
            </h3>
            {hostItem}
          </div>
          <ul className="m-0 flex list-none flex-col rounded-xl border border-border-subtle p-1">
            {props.recent.map((item) => (
              <li key={item.path}>
                <RecentRow
                  item={item}
                  busy={busy === item.path}
                  disabled={busy !== null}
                  onPick={() => {
                    start(item.path, item.path);
                  }}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
      <div
        className={`flex items-center justify-between gap-2 ${props.recent.length === 0 ? "mt-6" : "mt-3"}`}
      >
        <div className="flex items-center gap-2">
          {props.canPick ? (
            <Button
              size="sm"
              variant="outline"
              iconStart={<FolderOpen />}
              loading={busy === "pick"}
              disabled={busy !== null}
              onClick={() => {
                start("pick", undefined);
              }}
            >
              {t("desktop.newThread.where.openFolder")}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            disabled={busy !== null}
            onClick={() => {
              props.onNoFolder();
              commands.requestComposer(null);
            }}
          >
            {t("desktop.newThread.where.noFolder")}
          </Button>
        </div>
        {props.recent.length === 0 ? <span className="text-text-tertiary">{hostItem}</span> : null}
      </div>
      {failed ? (
        <p role="alert" className="m-0 mt-3 text-ui text-warning-text">
          {t("desktop.newThread.where.failed")}
        </p>
      ) : null}
    </div>
  );
}

function RecentRow(props: {
  readonly item: RecentWorkspace;
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly onPick: () => void;
}): ReactNode {
  const { item } = props;
  const tail = pathTailOf(item.path);
  return (
    <button
      type="button"
      title={item.path}
      disabled={props.disabled}
      aria-busy={props.busy ? true : undefined}
      onClick={props.onPick}
      className="flex h-9 w-full min-w-0 items-center gap-2.5 rounded-lg border-0 bg-transparent px-2.5 text-left outline-none hover:bg-neutral-hover focus-visible:focus-ring disabled:cursor-default disabled:hover:bg-transparent"
    >
      <Folder className="size-4 shrink-0 text-text-tertiary" />
      <span className="max-w-[45%] shrink-0 truncate text-ui-strong text-text-primary">
        {folderNameOf(item.path)}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-footnote text-text-tertiary">
        {tail ?? ""}
      </span>
      <span className="shrink-0 text-footnote text-text-tertiary">
        {t("desktop.threads.recentCount", { count: item.count })}
      </span>
    </button>
  );
}

function NoFolder(props: { readonly onPick: () => void }): ReactNode {
  return (
    <div className="mt-5 flex flex-col items-center gap-2">
      <p className="m-0 text-ui text-text-tertiary">{t("desktop.newThread.noFolder.caption")}</p>
      <Button size="xs" variant="ghost" onClick={props.onPick}>
        {t("desktop.newThread.noFolder.pick")}
      </Button>
    </div>
  );
}
