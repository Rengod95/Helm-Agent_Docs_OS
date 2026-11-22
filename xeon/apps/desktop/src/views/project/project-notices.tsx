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
import { listedThreadsOf } from "../thread-groups.ts";
import { rowLabelOf } from "../thread-nav-model.ts";
import { projectOfThread, sameFolderRunningOf } from "./project-model.ts";
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

/** 알림 카드 한 장의 틀: 왼쪽에 제목(13/600)과 한 줄, 오른쪽에 동작과 닫기가 한 줄로 선다(세로 가운데) */
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
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid min-w-0 flex-1 gap-1">
          <h2 id={headingId} className="m-0 text-ui-strong text-text-primary">
            {props.title}
          </h2>
          <div className="flex min-w-0 items-center gap-1">
            <p className="m-0 text-ui text-text-secondary">{props.body}</p>
            <InfoTip text={props.info} />
          </div>
        </div>
        <div className="flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-2">
          {props.actions}
        </div>
        <IconButton
          size="xs"
          variant="ghost"
          label={t("desktop.projects.notice.dismiss")}
          onClick={props.onDismiss}
        >
          <X aria-hidden />
        </IconButton>
      </div>
    </Card>
  );
}

function SameFolderNotice(): ReactNode {
  const open = useOpenThread();
  const commands = useCommands();
  const threads = listedThreadsOf(useThreadSummaries());
  const [dismissed, setDismissed] = useState<string | null>(null);
  const others = sameFolderRunningOf(open, threads);
  if (open === undefined || open.workspace === null || others.length === 0) return null;
  // 닫은 뒤 다른 대화가 더 돌기 시작하면 다시 뜬다
  const key = `${open.threadId}:${others.map((other) => other.threadId).join(",")}`;
  if (dismissed === key) return null;
  return (
    <NoticeCard
      kind="same-folder"
      title={t("desktop.projects.notice.sameFolder.title", { count: others.length })}
      body={t("desktop.projects.notice.sameFolder.body")}
      info={t("desktop.projects.notice.sameFolder.info", { path: open.workspace })}
      onDismiss={() => {
        setDismissed(key);
      }}
      actions={others.map((other) => {
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
