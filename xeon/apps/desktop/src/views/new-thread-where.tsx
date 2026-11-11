import { t } from "@fresnel/client/i18n";
import { Button } from "@caustic/react";
import { detach, rethrow } from "@fresnel/contracts";
import { Folder, FolderOpen } from "@caustic/react/icons";
import { useState, type ReactNode } from "react";
import { useThreadSummaries } from "../state/engine/index.ts";
import { useEngineTarget } from "../state/ui/index.ts";
import { InfoTip } from "./craft/info-tip.tsx";
import { useFolderPick } from "./folder-pick-context.ts";
import { useStartNewThread, type NewThreadResult } from "./new-thread-flow.ts";
import { recentWorkspacesOf, type RecentWorkspace } from "./new-thread-model.ts";
import { folderNameOf, hostOf, pathTailOf, type ContextHostKind } from "./thread-context-model.ts";

// 작업 폴더가 아직 없는 새 대화의 "어디서 작업할까요" 고르기(DP-70). 최근 폴더 행(이름 + 경로 꼬리), "폴더 열기…", "폴더 없이 시작"이다.
// 대화의 작업 폴더는 만든 뒤에 바꿀 수 없어서(`thread.update`에 workspace가 없다) 폴더를 고르면 그 폴더의 새 대화로 간다(`useStartNewThread`가 빈 새 대화가 있으면 그리로 간다).
// 아래 한 줄은 이 대화를 어느 호스트가 돌리는지 말한다.

/** 호스트 한 줄의 메시지 */
function hostLineOf(host: ContextHostKind, name: string | null): string {
  if (host === "local") return t("desktop.emptyThread.where.hostLocal");
  if (host === "ssh") return t("desktop.emptyThread.where.hostSsh", { name: name ?? "" });
  return name === null
    ? t("desktop.emptyThread.where.hostWebAnon")
    : t("desktop.emptyThread.where.hostWeb", { name });
}

const ROW =
  "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-ui text-text-primary outline-none hover:bg-neutral-hover focus-visible:focus-ring";

/** 최근 폴더 한 행. 이름은 13px이고 경로 꼬리와 대화 수는 곁 정보 크기다 */
export function RecentRow(props: {
  readonly item: RecentWorkspace;
  readonly disabled: boolean;
  readonly onPick: (path: string) => void;
}): ReactNode {
  const { item } = props;
  const tail = pathTailOf(item.path);
  return (
    <button
      type="button"
      className={ROW}
      disabled={props.disabled}
      title={item.path}
      onClick={() => {
        props.onPick(item.path);
      }}
    >
      <Folder className="size-4 shrink-0 text-text-tertiary" aria-hidden />
      <span className="shrink-0">{folderNameOf(item.path)}</span>
      {tail === null ? null : (
        <span className="min-w-0 truncate font-mono text-ui-xs text-text-tertiary">{tail}</span>
      )}
      <span className="ml-auto shrink-0 text-ui-xs tabular-nums text-text-tertiary">
        {t("desktop.emptyThread.where.count", { count: item.count })}
      </span>
    </button>
  );
}

export function NewThreadWhere(props: { readonly onNoFolder: () => void }): ReactNode {
  const folderPick = useFolderPick();
  const startThread = useStartNewThread(folderPick ?? undefined);
  const recent = recentWorkspacesOf(useThreadSummaries());
  const target = hostOf(useEngineTarget());
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const run = (workspace?: string): void => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    detach(
      startThread(workspace)
        .then((result: NewThreadResult) => {
          if (result.kind === "pickFailed" || result.kind === "failed") setFailed(true);
          return undefined;
        })
        .finally(() => {
          setBusy(false);
        }),
      rethrow,
    );
  };
  return (
    <section aria-labelledby="new-thread-where" className="mx-auto grid w-full max-w-120 gap-3">
      <h2 id="new-thread-where" className="m-0 text-center text-title-4 text-text-primary">
        {t("desktop.emptyThread.where.question")}
      </h2>
      {recent.length > 0 ? (
        <div
          role="group"
          aria-label={t("desktop.emptyThread.where.recent")}
          className="grid gap-px"
        >
          {recent.map((item) => (
            <RecentRow key={item.path} item={item} disabled={busy} onPick={run} />
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {folderPick === null ? null : (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              run();
            }}
          >
            <FolderOpen aria-hidden />
            {t("desktop.emptyThread.where.open")}
          </Button>
        )}
        <span className="inline-flex items-center gap-1">
          <Button size="sm" variant="ghost" disabled={busy} onClick={props.onNoFolder}>
            {t("desktop.emptyThread.where.none")}
          </Button>
          <InfoTip text={t("desktop.emptyThread.where.noneInfo")} />
        </span>
      </div>
      {failed ? (
        <p role="alert" className="m-0 text-ui text-danger-text">
          {t("desktop.emptyThread.where.failed")}
        </p>
      ) : null}
      <p className="m-0 text-ui text-text-tertiary">{hostLineOf(target.host, target.name)}</p>
    </section>
  );
}
