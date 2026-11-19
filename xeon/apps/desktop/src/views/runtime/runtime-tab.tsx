// 런타임 탭(대화 영역 오른쪽 "런타임", spec §4.9.8). 구역 넷: 주도 락, 켜진 그룹과 확장, 전환 기록, 실패.
// 데이터는 열린 대화 하나를 따라 읽는다(`ext.list`, `group.list`, `drive.frames`). 목록 알림(`reloadOnExtChanges`)마다, 그리고 주도권 스택이 바뀐 알림(`drive.framesChanged`)마다 다시 읽는다.
// 전환 기록과 실패 기록은 엔진 거울이 받은 이벤트를 쓴다(읽기를 하지 않는다).
// 모양은 `RuntimeBody`가 그린다. 값은 `packages/client/src/workbench/runtime.ts`의 모델이 만든다.
import { t, type MessageId } from "@fresnel/client/i18n";
import {
  failureGroupsOf,
  runtimeRowsOf,
  runtimeViewOf,
  transitionRowsOf,
  type DriveMemberVM,
  type DriveRoleOf,
  type HandlerFailureEntry,
  type RuntimeDriveView,
  type RuntimeExtRowVM,
  type TransitionChange,
  type TransitionEntry,
  type TransitionRowVM,
} from "@fresnel/client/workbench";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import type { DriveFrameView } from "@fresnel/contracts/extensions";
import type { LeaseReleasedPayload, ScopeChangedPayload } from "@fresnel/contracts/records";
import type { ExtListEntry, GroupStatusWire } from "@fresnel/contracts/wire";
import { Alert, Badge, Skeleton, StatusDot } from "@caustic/react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  useHandlerFailures,
  useLinkPhase,
  useOpenThreadId,
  useTransitions,
} from "../../state/engine/index.ts";
import { useCommands } from "../commands.ts";
import { reloadOnExtChanges, useWorkbenchController } from "../workbench/controller.ts";
import { FailureRecords } from "../workbench/ext-detail.tsx";
import { kindText, stateText, stateTone } from "../workbench/ext-row.tsx";
import { HookAnswersContext, HookNoticeList } from "../workbench/hook-notice.tsx";
import { DriveStackCards, type DriveStopControl } from "../convo/drive-stack.tsx";
import { useDriveStop } from "../convo/drive-frames.ts";
import { driveStackOf } from "../convo/drive-stack-model.ts";

/** 한 묶음의 읽기 상태 */
export type Load<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly value: T };

/** drive 구역의 읽은 값: 그룹 목록과 대화의 주도권 스택(`drive.frames`) */
interface DriveData {
  readonly groups: readonly GroupStatusWire[];
  readonly frames: readonly DriveFrameView[];
}

/** 탭이 읽는 값 전부. 연결이 없으면 `offline`이라 읽지 않는다 */
export interface RuntimeData {
  readonly entries: Load<readonly ExtListEntry[]>;
  readonly drive: Load<DriveData>;
}

const LOADING: RuntimeData = { entries: { kind: "loading" }, drive: { kind: "loading" } };

/**
 * 열린 대화의 런타임 값을 읽는다. 대화가 바뀌거나 연결이 서면 다시 읽고, 확장 목록 알림과 주도권 스택 알림마다 다시 읽는다.
 * 대화가 없거나 연결이 없으면 읽지 않는다. 읽은 값은 대화 id와 함께 둔다. 대화가 바뀌면 다른 대화의 값은 읽는 중으로 보인다.
 */
function useRuntimeData(threadId: ThreadId | null, live: boolean): RuntimeData {
  const commands = useCommands();
  const [loaded, setLoaded] = useState<{ readonly key: string; readonly data: RuntimeData } | null>(
    null,
  );
  const key = threadId ?? "";
  useEffect(() => {
    if (!live || threadId === null) return undefined;
    let active = true;
    const load = async (): Promise<void> => {
      const [entries, groups, frames] = await Promise.all([
        commands.workbench.list(threadId),
        commands.workbench.groups(threadId),
        commands.workbench.driveFrames(threadId),
      ]);
      if (!active) return;
      setLoaded({
        key,
        data: {
          entries: entries.ok ? { kind: "ready", value: entries.value } : { kind: "error" },
          drive:
            groups.ok && frames.ok
              ? { kind: "ready", value: { groups: groups.value, frames: frames.value } }
              : { kind: "error" },
        },
      });
    };
    detach(load(), rethrow);
    const off = reloadOnExtChanges(commands.workbench, load);
    const offDrive = commands.workbench.onDriveFramesChanged(threadId, () => {
      detach(load(), rethrow);
    });
    return () => {
      active = false;
      off();
      offDrive();
    };
  }, [commands, live, threadId, key]);
  return loaded !== null && loaded.key === key ? loaded.data : LOADING;
}

/** 엔진 연결 상태를 탭의 세 갈래로 줄인다: 살아 있음, 끊김(읽지 않는다), 붙는 중(기다린다) */
export type LinkState = "live" | "offline" | "pending";

export function linkOf(phase: ReturnType<typeof useLinkPhase>): LinkState {
  if (phase === "live") return "live";
  if (phase === "offline" || phase === "failed") return "offline";
  return "pending";
}

function Section(props: { readonly title: string; readonly children: ReactNode }): ReactNode {
  return (
    <section aria-label={props.title} className="grid content-start gap-2">
      <h3 className="m-0 text-ui font-semibold text-text-primary">{props.title}</h3>
      {props.children}
    </section>
  );
}

function Member(props: { readonly member: DriveMemberVM }): ReactNode {
  const { member } = props;
  return (
    <li className="flex flex-wrap items-center gap-2 text-ui">
      <span className="text-text-primary">{member.displayName}</span>
      <span className="font-mono text-text-tertiary">{member.id}</span>
    </li>
  );
}

function DriveSection(props: {
  readonly view: RuntimeDriveView;
  readonly frames: readonly DriveFrameView[];
  readonly stop: DriveStopControl | null;
}): ReactNode {
  const { view } = props;
  return (
    <div className="grid gap-2">
      {!view.holderAgrees && <Alert tone="warning">{t("desktop.runtime.lock.mismatch")}</Alert>}
      {/* 쌓인 판: 맨 위가 지금 Drive를 쥔 칸, 아래가 핸드오프하고 기다리는 칸, 맨 아래 "기본"(lcM6b §6.6.1) */}
      <DriveStackCards view={driveStackOf(props.frames)} stop={props.stop} />
      <p className="m-0 flex flex-wrap items-center gap-2 text-ui">
        <span className="text-text-tertiary">{t("desktop.runtime.lock.holder")}</span>
        {view.holder === null ? (
          <span className="text-text-tertiary">{t("desktop.runtime.lock.holder.none")}</span>
        ) : (
          <>
            <span className="text-text-primary">{view.holder.displayName}</span>
            <span className="font-mono text-text-tertiary">{view.holder.id}</span>
          </>
        )}
      </p>
      <div className="grid gap-1">
        <h4 className="m-0 text-ui font-medium text-text-secondary">
          {t("desktop.runtime.queue.title")}
        </h4>
        {view.queue.length === 0 ? (
          <p className="m-0 text-ui text-text-tertiary">{t("desktop.runtime.queue.empty")}</p>
        ) : (
          <ul className="m-0 grid list-none gap-1 p-0">
            {view.queue.map((member) => (
              <Member key={member.id} member={member} />
            ))}
          </ul>
        )}
      </div>
      {view.errored.length > 0 && (
        <div className="grid gap-1">
          <h4 className="m-0 text-ui font-medium text-text-secondary">
            {t("desktop.runtime.errored.title")}
          </h4>
          <ul className="m-0 grid list-none gap-1 p-0">
            {view.errored.map((member) => (
              <Member key={member.id} member={member} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** 그룹 역할의 글. 역할 값마다 메시지 id 하나다(템플릿으로 만들지 않는다) */
export const RoleText: Readonly<Record<DriveRoleOf, MessageId>> = {
  holder: "desktop.runtime.role.holder",
  waiting: "desktop.runtime.role.waiting",
  error: "desktop.runtime.role.error",
  none: "desktop.runtime.role.none",
};

/** 전환 기록의 해제 사유마다 글 하나다(템플릿으로 만들지 않는다) */
const ReleasedText: Readonly<Record<LeaseReleasedPayload["reason"], MessageId>> = {
  done: "desktop.runtime.transitions.released.done",
  disabled: "desktop.runtime.transitions.released.disabled",
  budget: "desktop.runtime.transitions.released.budget",
  error: "desktop.runtime.transitions.released.error",
  idle: "desktop.runtime.transitions.released.idle",
  revoked: "desktop.runtime.transitions.released.revoked",
  restart: "desktop.runtime.transitions.released.restart",
  waiting: "desktop.runtime.transitions.released.waiting",
};

/** 켜기·끄기 적용의 글. 상태와 사유 조합마다 글 하나다 */
const ScopeText: Readonly<
  Record<
    ScopeChangedPayload["status"],
    Readonly<Record<NonNullable<ScopeChangedPayload["reason"]>, MessageId>>
  >
> = {
  enabled: {
    request: "desktop.runtime.transitions.scope.enabled.request",
    auto_disable: "desktop.runtime.transitions.scope.enabled.autoDisable",
    safe_mode: "desktop.runtime.transitions.scope.enabled.safeMode",
    startup_disable: "desktop.runtime.transitions.scope.enabled.startupDisable",
  },
  disabled: {
    request: "desktop.runtime.transitions.scope.disabled.request",
    auto_disable: "desktop.runtime.transitions.scope.disabled.autoDisable",
    safe_mode: "desktop.runtime.transitions.scope.disabled.safeMode",
    startup_disable: "desktop.runtime.transitions.scope.disabled.startupDisable",
  },
};

/** 전환 한 건의 글 id. 종류와 값으로 고른다. 거절 사유는 알려진 값(기다림 상한)만 따로 두고 나머지는 한 글이다 */
function transitionTextOf(change: TransitionChange): MessageId {
  switch (change.kind) {
    case "lease.acquired":
      return "desktop.runtime.transitions.acquired";
    case "lease.released":
      return ReleasedText[change.reason];
    case "lease.rejected":
      return change.reason === "wait_limit"
        ? "desktop.runtime.transitions.rejected.waitLimit"
        : "desktop.runtime.transitions.rejected.other";
    case "scope.changed":
      return ScopeText[change.status][change.reason];
    default:
      return assertNever(change, "transitionTextOf");
  }
}

function TransitionRow(props: { readonly row: TransitionRowVM }): ReactNode {
  const { row } = props;
  return (
    <li className="flex flex-wrap items-center gap-2 text-ui">
      <span className="font-mono text-text-tertiary">{row.time}</span>{" "}
      {row.turn !== null && (
        <>
          <span className="font-mono text-text-tertiary">
            {t("desktop.runtime.transitions.turn", { turn: row.turn })}
          </span>{" "}
        </>
      )}
      <span className="text-text-primary">{t(transitionTextOf(row.change))}</span>{" "}
      <span className="font-mono text-text-tertiary">{row.subject}</span>
    </li>
  );
}

function ExtRow(props: { readonly row: RuntimeExtRowVM }): ReactNode {
  const { row } = props;
  return (
    <li className="grid gap-1 rounded-md px-2 py-1.5 text-ui">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 truncate text-text-primary">
          {row.displayName !== null && <span>{row.displayName} </span>}
          <span className="font-mono text-text-tertiary">{row.name}</span>
        </span>
        <span className="font-mono text-text-tertiary">{row.layer}</span>
        <Badge size="sm">{kindText(row.kind)}</Badge>
        {row.drive !== null && row.drive !== "none" && (
          <Badge size="sm">{t(RoleText[row.drive])}</Badge>
        )}
        <span className="ms-auto">
          <StatusDot tone={stateTone(row.state)} label={stateText(row.state)} />
        </span>
      </div>
      <span className="text-text-tertiary">
        {t("desktop.runtime.exts.hooks", { count: row.hookCount })}
      </span>
    </li>
  );
}

/**
 * 런타임 탭 그림. 값 없이 그릴 수 있도록 데이터와 연결 상태, 실패 기록을 받는다.
 * 연결이 없으면 읽지 않은 구역은 끊김 글을, 대화가 없으면 빈 글을 보인다. 실패 구역은 연결과 무관하게 엔진 거울의 기록을 보인다.
 * `notices`는 맨 위(첫 구역 위)에 그대로 놓는다. 훅 알림처럼 스토어가 필요한 부품은 `RuntimeTab`이 넘긴다.
 */
export function RuntimeBody(props: {
  readonly threadId: ThreadId | null;
  readonly link: LinkState;
  readonly data: RuntimeData;
  readonly failures: readonly HandlerFailureEntry[];
  readonly transitions: readonly TransitionEntry[];
  readonly notices?: ReactNode;
  /** 도는 턴이 있으면 맨 위 판의 Drive 멈추기 */
  readonly stop?: DriveStopControl | null;
}): ReactNode {
  const { data, link } = props;
  const noThread = props.threadId === null;
  const transitionsBody = (): ReactNode => {
    if (noThread)
      return <p className="m-0 text-ui text-text-tertiary">{t("desktop.runtime.empty.thread")}</p>;
    const rows = transitionRowsOf(props.transitions);
    if (rows.length === 0)
      return (
        <p className="m-0 text-ui text-text-tertiary">{t("desktop.runtime.transitions.empty")}</p>
      );
    return (
      <ul className="m-0 grid list-none gap-1 p-0">
        {rows.map((row) => (
          <TransitionRow key={row.seq} row={row} />
        ))}
      </ul>
    );
  };
  const driveBody = (): ReactNode => {
    if (noThread)
      return <p className="m-0 text-ui text-text-tertiary">{t("desktop.runtime.empty.thread")}</p>;
    if (link === "offline")
      return <p className="m-0 text-ui text-text-tertiary">{t("desktop.runtime.offline")}</p>;
    if (link === "pending" || data.drive.kind === "loading") return <Skeleton height={48} />;
    if (data.drive.kind === "error")
      return <Alert tone="danger">{t("desktop.runtime.lock.failed")}</Alert>;
    const { groups, frames } = data.drive.value;
    return (
      <DriveSection
        view={runtimeViewOf(groups, frames)}
        frames={frames}
        stop={props.stop ?? null}
      />
    );
  };
  const extsBody = (): ReactNode => {
    if (noThread) return null;
    if (link === "offline")
      return <p className="m-0 text-ui text-text-tertiary">{t("desktop.runtime.offline")}</p>;
    if (link === "pending" || data.entries.kind === "loading") return <Skeleton height={48} />;
    if (data.entries.kind === "error")
      return <Alert tone="danger">{t("desktop.runtime.exts.failed")}</Alert>;
    const groups = data.drive.kind === "ready" ? data.drive.value.groups : [];
    const rows = runtimeRowsOf(data.entries.value, groups);
    if (rows.length === 0)
      return <p className="m-0 text-ui text-text-tertiary">{t("desktop.runtime.exts.empty")}</p>;
    return (
      <ul className="m-0 grid list-none gap-0.5 p-0">
        {rows.map((row) => (
          <ExtRow key={row.name} row={row} />
        ))}
      </ul>
    );
  };
  const groups = failureGroupsOf(props.failures);
  return (
    <div className="grid content-start gap-5">
      {props.notices}
      <Section title={t("desktop.runtime.section.lock")}>{driveBody()}</Section>
      <Section title={t("desktop.runtime.section.exts")}>{extsBody()}</Section>
      <Section title={t("desktop.runtime.section.transitions")}>{transitionsBody()}</Section>
      <Section title={t("desktop.runtime.section.failures")}>
        {groups.length === 0 ? (
          <p className="m-0 text-ui text-text-tertiary">{t("desktop.runtime.failures.empty")}</p>
        ) : (
          groups.map((group) => (
            <div key={group.owner} className="grid gap-1">
              <h4 className="m-0 font-mono text-ui-sm text-text-secondary">
                {group.owner.startsWith("hook:")
                  ? t("desktop.runtime.failures.owner.hook", { name: group.label })
                  : group.label}
              </h4>
              <FailureRecords rows={group.rows} failed={false} />
            </div>
          ))
        )}
      </Section>
    </div>
  );
}

/**
 * 런타임 탭 맨 위의 외부 훅 알림(질문과 두 답). 답은 컨트롤러로 보낸다. 워크벤치 스토어가 필요하므로 `RuntimeTab`만 마운트한다.
 * 스토어가 비어 있으면(안전 모드 포함) 아무것도 그리지 않는다.
 */
function RuntimeHookNotices(): ReactNode {
  const controller = useWorkbenchController();
  const hookAnswers = useMemo(
    () => ({
      keepOn: (hook: string) => controller.hookKeepOn(hook),
      keepOff: (hook: string) => controller.hookKeepOff(hook),
    }),
    [controller],
  );
  return (
    <div className="grid gap-2 [&:empty]:hidden">
      <HookAnswersContext value={hookAnswers}>
        <HookNoticeList compact />
      </HookAnswersContext>
    </div>
  );
}

/** 런타임 탭. 열린 대화와 엔진 연결을 읽어 `RuntimeBody`에 넘긴다. 맨 위 훅 알림은 워크벤치 스토어를 읽는 `RuntimeHookNotices`다 */
export function RuntimeTab(): ReactNode {
  const threadId = useOpenThreadId();
  return threadId === null ? (
    <RuntimeTabFor threadId={null} />
  ) : (
    <RuntimeTabLive threadId={threadId} />
  );
}

/** 열린 대화가 있으면 그 대화의 Drive 멈추기를 맨 위 판에 둔다 */
function RuntimeTabLive(props: { readonly threadId: ThreadId }): ReactNode {
  const live = useLinkPhase() === "live";
  const stop = useDriveStop(props.threadId, !live);
  return <RuntimeTabFor threadId={props.threadId} stop={stop} />;
}

function RuntimeTabFor(props: {
  readonly threadId: ThreadId | null;
  readonly stop?: DriveStopControl | null;
}): ReactNode {
  const { threadId } = props;
  const link = linkOf(useLinkPhase());
  const data = useRuntimeData(threadId, link === "live");
  const failures = useHandlerFailures();
  const transitions = useTransitions(threadId);
  return (
    <RuntimeBody
      threadId={threadId}
      link={link}
      data={data}
      failures={failures}
      transitions={transitions}
      notices={<RuntimeHookNotices />}
      stop={props.stop ?? null}
    />
  );
}
