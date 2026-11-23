// T7 알림 둘(craft-flows §6.7, AC-27, AC-43). 대화 화면의 입력창 위 쌓임(`data-chat-stack`)에 선다. 막지 않고 알리기만 한다.
// 1. 같은 폴더: 지금 연 대화와 같은 작업 폴더에서 다른 대화가 돌고 있다(U6). 목록의 상태로 정하므로 그 대화가 멈추면 사라진다.
//    엔진의 `thread.create.sameFolder`는 만들 때 한 번이고 "열린" 대화까지 담아, 돌고 있는지를 말하는 이 알림에는 목록 상태를 쓴다.
// 2. 승인 전 플러그인: 이 대화의 프로젝트가 싣고 온 플러그인이 리뷰를 기다려 실행되지 않는다(`project.get.pendingReview`). 리뷰로 가는 길을 둔다.
// 경고 문장은 보이고, 폴더 경로와 worktree 설명은 정보 아이콘 뒤다. 닫으면 그 대화(같은 폴더) 또는 그 프로젝트(같은 수)에서 다시 뜨지 않는다.
import { t } from "@fresnel/client/i18n";
import { Button, Card, IconButton } from "@caustic/react";
import { X } from "@caustic/react/icons";
import { useId, useState, type ReactNode } from "react";
import { useOpenThread, useThreadSummaries } from "../../state/engine/index.ts";
import { useCommands } from "../commands.ts";
import { InfoTip } from "../craft/info-tip.tsx";
import { ProgressOrb } from "../effects/progress-orb.tsx";
import { isDefaultFolderPath } from "../new-thread-model.ts";
import { listedThreadsOf } from "../thread-groups.ts";
import { rowLabelOf } from "../thread-nav-model.ts";
import { noticeActionsOf, projectOfThread, sameFolderRunningOf } from "./project-model.ts";
import { useProjects } from "./project-source.tsx";
import { useOpenReview } from "./project-settings.tsx";

export function ProjectNotices(): ReactNode {
  return (
    <>
      <SameFolderNotice />
      <PendingPluginsNotice />
    </>
  );
}

/**
 * 알림 카드 한 장의 틀(AGE-75). 첫 줄은 제목(13/600)과 닫기다: 닫기는 늘 카드 오른쪽 위 모서리에서 제목 줄의 세로 가운데에 선다.
 * 둘째 줄은 한 줄 설명(정보 아이콘)과 동작이다. 둘이 한 줄에 들어가면 동작이 설명 오른쪽에 서고, 모자라면 동작이 설명 아래 줄로 내려가
 * 제목과 같은 왼쪽 선에서 왼쪽 정렬로 흐르고 넘치면 왼쪽부터 다시 접힌다. 설명 칸의 basis는 한 줄 폭이라(`flex-auto`) 설명이 접혀서 동작이
 * 옆에 남는 일은 없다. 동작이 아래 줄로 간 뒤 창이 더 좁으면 그때 설명이 접힌다(DP-180, DP-231)
 */
function NoticeCard(props: {
  readonly kind: string;
  readonly title: string;
  readonly body: string;
  readonly info: string;
  readonly actions: ReactNode;
  readonly onDismiss: () => void;
}): ReactNode {
  const headingId = useId();
  return (
    <Card
      role="status"
      aria-labelledby={headingId}
      size="sm"
      data-project-notice={props.kind}
      className="min-w-0"
    >
      <div className="grid min-w-0 gap-1">
        {/* 닫기 칸은 제목 한 줄 높이(1lh)이고 단추는 그 안 세로 가운데라, 단추가 제목보다 커도 제목은 카드 위 여백에 붙는다 */}
        <div className="flex min-w-0 items-start gap-2 text-ui-strong" data-slot="notice-head">
          <h2 id={headingId} className="m-0 min-w-0 flex-1 text-ui-strong text-text-primary">
            {props.title}
          </h2>
          <span className="flex h-lh flex-none items-center">
            <IconButton
              size="xs"
              variant="ghost"
              label={t("desktop.projects.notice.dismiss")}
              data-slot="notice-dismiss"
              onClick={props.onDismiss}
            >
              <X aria-hidden />
            </IconButton>
          </span>
        </div>
        <div
          className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2"
          data-slot="notice-main"
        >
          <div className="flex min-w-0 flex-auto items-center gap-1">
            <p className="m-0 text-ui text-text-secondary">{props.body}</p>
            <InfoTip text={props.info} />
          </div>
          <div
            className="flex min-w-0 max-w-full flex-wrap items-center gap-2"
            data-slot="notice-actions"
          >
            {props.actions}
          </div>
        </div>
      </div>
    </Card>
  );
}

function SameFolderNotice(): ReactNode {
  const open = useOpenThread();
  const commands = useCommands();
  const threads = listedThreadsOf(useThreadSummaries());
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const others = sameFolderRunningOf(open, threads);
  if (open === undefined || open.workspace === null || others.length === 0) return null;
  // 닫은 뒤 다른 대화가 더 돌기 시작하면 다시 뜬다
  const key = `${open.threadId}:${others.map((other) => other.threadId).join(",")}`;
  if (dismissed === key) return null;
  // 펼침은 지금 목록에만 걸린다: 다른 대화가 더 돌기 시작하면 다시 셋까지 접힌다
  const view = noticeActionsOf(others, expanded === key);
  // 프로젝트 없는 대화의 내부 기본 폴더(`default-project/<id>`)는 사용자가 고른 폴더가 아니라 경로를 보이지 않는다
  const sameFolderInfo = isDefaultFolderPath(open.workspace, open.threadId)
    ? t("desktop.projects.notice.sameFolder.infoNoPath")
    : t("desktop.projects.notice.sameFolder.info", { path: open.workspace });
  return (
    <NoticeCard
      kind="same-folder"
      title={t("desktop.projects.notice.sameFolder.title", { count: others.length })}
      body={t("desktop.projects.notice.sameFolder.body")}
      info={sameFolderInfo}
      onDismiss={() => {
        setDismissed(key);
      }}
      actions={
        <>
          {view.shown.map((other) => {
            const title = rowLabelOf(other).text ?? t("desktop.threads.untitled");
            return (
              <Button
                key={other.threadId}
                size="sm"
                variant="outline"
                iconStart={<ProgressOrb />}
                className="max-w-60 min-w-0"
                onClick={() => {
                  commands.selectThread(other.threadId);
                }}
              >
                <span className="min-w-0 truncate">{title}</span>
              </Button>
            );
          })}
          {view.hidden > 0 || view.canFold ? (
            <Button
              size="sm"
              variant="ghost"
              className="text-text-secondary"
              aria-expanded={view.canFold}
              data-slot="notice-more"
              onClick={() => {
                setExpanded(view.canFold ? null : key);
              }}
            >
              {view.hidden > 0
                ? t("desktop.projects.more", { count: view.hidden })
                : t("desktop.projects.less")}
            </Button>
          ) : null}
        </>
      }
    />
  );
}

function PendingPluginsNotice(): ReactNode {
  const open = useOpenThread();
  const { load } = useProjects();
  const openReview = useOpenReview();
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (open === undefined || load.status !== "ready") return null;
  const project = projectOfThread(open, open.workspace, load.projects);
  if (project === undefined) return null;
  const pending = load.pending.get(project.projectId) ?? 0;
  if (pending === 0) return null;
  const key = `${project.projectId}:${pending}`;
  if (dismissed === key) return null;
  return (
    <NoticeCard
      kind="pending-plugins"
      title={t("desktop.projects.notice.pending.title", { count: pending })}
      body={t("desktop.projects.notice.pending.body")}
      info={t("desktop.projects.notice.pending.info", { name: project.name })}
      onDismiss={() => {
        setDismissed(key);
      }}
      actions={
        <Button size="sm" variant="outline" onClick={openReview}>
          {t("desktop.projects.openReview")}
        </Button>
      }
    />
  );
}
