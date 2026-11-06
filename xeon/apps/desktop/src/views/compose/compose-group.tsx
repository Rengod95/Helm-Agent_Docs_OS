// 구성기의 그룹 보기와 흐름 보기의 입구(§6.28.1, §6.28.2). 설치 그룹의 매니페스트 `group.composition`을 읽기 전용으로 보인다.
// 흐름 보기의 캔버스·개요·초안 편집은 `compose-flow.tsx`가 맡는다. 선언이 없으면 "구성 정보 없음" 블록 하나, 단계 선언이 없으면 "단계 선언이 없어요"다. 훅 이름으로 짐작하지 않는다.
// 검사는 `ext.validateComposition`이고 막힌 곳이 있으면 목록 위에 Alert 하나로 보인다(DP-28).
import { t } from "@fresnel/client/i18n";
import {
  blockRowsOf,
  compositionOf,
  flowDraftOf,
  issuesByBlockOf,
  type FlowDraft,
  type TabLink,
  type TabRead,
} from "@fresnel/client/workbench";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import type { CompositionDecl } from "@fresnel/contracts/extensions";
import { Alert, Button, EmptyState, Skeleton } from "@caustic/react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useCommands } from "../commands.ts";
import { InfoTip } from "../craft/info-tip.tsx";
import { useTabRead } from "../workbench/tab-read.ts";
import { CheckBanner, type CheckRead } from "./compose-check.tsx";
import { FlowWorkspace } from "./compose-flow.tsx";
import { GroupCanvas } from "./compose-group-canvas.tsx";

const MUTED = "m-0 text-ui-sm text-text-tertiary";

function useCheck(composition: CompositionDecl | null, link: TabLink): CheckRead {
  const commands = useCommands();
  const [read, setRead] = useState<CheckRead>({ kind: "loading" });
  useEffect(() => {
    if (composition === null || link !== "live") return undefined;
    let active = true;
    const run = async (): Promise<void> => {
      const got = await commands.workbench.validateComposition(composition);
      if (!active) return;
      setRead(got.ok ? { kind: "done", issues: got.value.issues } : { kind: "failed" });
    };
    detach(run(), rethrow);
    return () => {
      active = false;
    };
  }, [commands, composition, link]);
  return read;
}

function Loading(): ReactNode {
  return (
    <div role="status" aria-busy="true" className="grid gap-2">
      <span className="sr-only">{t("desktop.compose.loading")}</span>
      {[0, 1, 2].map((line) => (
        <Skeleton key={line} height={48} />
      ))}
    </div>
  );
}

/** 읽기 상태 가르기. 값이 있으면 `children`을 그린다 */
export function ReadGate<T>(props: {
  readonly read: TabRead<T>;
  readonly onRetry: () => void;
  readonly children: (value: T) => ReactNode;
}): ReactNode {
  const { read } = props;
  switch (read.kind) {
    case "loading":
      return <Loading />;
    case "offline":
      return <p className={MUTED}>{t("desktop.compose.offline")}</p>;
    case "error":
      return (
        <Alert
          tone="danger"
          variant="soft"
          size="sm"
          action={
            <Button size="xs" variant="outline" onClick={props.onRetry}>
              {t("desktop.compose.retry")}
            </Button>
          }
        >
          {t("desktop.compose.loadFailed")}
        </Alert>
      );
    case "ready":
      return (
        <div className="grid gap-3">
          {read.stale ? <p className={MUTED}>{t("desktop.compose.stale")}</p> : null}
          {props.children(read.value)}
        </div>
      );
    default:
      return assertNever(read, "TabRead");
  }
}

export function NoComposition(): ReactNode {
  return (
    <EmptyState
      size="sm"
      surface="none"
      mark={null}
      title={t("desktop.compose.none.title")}
      description={t("desktop.compose.none.body")}
    />
  );
}

/** 블록 캔버스와 검사 띠. 검사 값은 호출자가 읽어 준다 */
export function GroupBlocks(props: {
  readonly composition: CompositionDecl;
  readonly check: CheckRead;
}): ReactNode {
  const issues = props.check.kind === "done" ? props.check.issues : [];
  const byBlock = issuesByBlockOf(props.composition, issues);
  return (
    <>
      <CheckBanner check={props.check} />
      <GroupCanvas rows={blockRowsOf(props.composition)} issuesByBlock={byBlock} />
    </>
  );
}

function GroupBody(props: {
  readonly composition: CompositionDecl;
  readonly link: TabLink;
}): ReactNode {
  const check = useCheck(props.composition, props.link);
  return <GroupBlocks composition={props.composition} check={check} />;
}

/** 흐름 보기의 입력. `draft`가 없으면 설치된 선언을 읽기 전용으로 보인다. 고치기 시작과 되돌리기는 `onDraft`로 초안을 넘긴다 */
export interface FlowBodyProps {
  readonly composition: CompositionDecl;
  readonly link: TabLink;
  /** 그룹 이름과 설치 여부. 시험 실행이 이 그룹을 시험 대화에서 켠다 */
  readonly name: string;
  readonly installed: boolean;
  readonly draft: FlowDraft | null;
  readonly onDraft: (draft: FlowDraft) => void;
  readonly onMake: (composition: CompositionDecl) => void;
}

/** 흐름 보기(§6.28.2). 단계 선언이 없으면 "단계 선언이 없어요"이고 고칠 것도 없다 */
export function FlowBody(props: FlowBodyProps): ReactNode {
  const phases = flowDraftOf(props.composition);
  if (phases === null) {
    // 시안은 제목 하나만 보인다. 이 그룹이 단계를 선언하지 않았다는 설명은 정보 아이콘 뒤에 둔다(DP-58)
    return (
      <EmptyState
        size="sm"
        surface="none"
        mark={null}
        title={
          <span className="inline-flex items-center gap-1">
            {t("desktop.compose.flow.none.head")}
            <InfoTip text={t("desktop.compose.flow.none.body")} />
          </span>
        }
      />
    );
  }
  return (
    <FlowWorkspace
      composition={props.composition}
      phases={phases}
      link={props.link}
      name={props.name}
      installed={props.installed}
      draft={props.draft}
      onDraft={props.onDraft}
      onMake={props.onMake}
    />
  );
}

/** 고른 그룹 하나의 그룹 보기 또는 흐름 보기. 이름이 바뀌면 새로 읽는다. 흐름 초안은 호출자가 든다 */
export function GroupSource(props: {
  readonly name: string;
  readonly link: TabLink;
  /** 고른 그룹이 설치 목록에 있나. 초안은 설치된 그룹에서만 나오므로 보통 참이다 */
  readonly installed: boolean;
  readonly mode: "group" | "flow";
  readonly flowDraft: FlowDraft | null;
  readonly onFlowDraft: (draft: FlowDraft) => void;
  readonly onMake: (composition: CompositionDecl) => void;
}): ReactNode {
  const commands = useCommands();
  const [version, setVersion] = useState(0);
  const load = useCallback(() => commands.workbench.get(props.name), [commands, props.name]);
  const read = useTabRead(`compose:${props.name}:${version}`, props.link, load);
  return (
    <ReadGate
      read={read}
      onRetry={() => {
        setVersion((current) => current + 1);
      }}
    >
      {(detail) => {
        const composition = compositionOf(detail.manifest);
        if (composition.kind === "none") return <NoComposition />;
        return props.mode === "group" ? (
          <GroupBody composition={composition.composition} link={props.link} />
        ) : (
          <FlowBody
            composition={composition.composition}
            link={props.link}
            name={props.name}
            installed={props.installed}
            draft={props.flowDraft}
            onDraft={props.onFlowDraft}
            onMake={props.onMake}
          />
        );
      }}
    </ReadGate>
  );
}
