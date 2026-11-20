// 런타임 탭(대화 영역 오른쪽 "런타임", spec §4.9.8). 구역 넷: Drive, 켜진 플러그인, 전환 기록, 실패.
// 데이터는 열린 대화 하나를 따라 읽는다(`ext.list`, `group.list`, `drive.frames`). 목록 알림(`reloadOnExtChanges`)마다, 그리고 Drive 스택이 바뀐 알림(`drive.framesChanged`)마다 다시 읽는다.
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
import { Alert, Skeleton, StatusDot } from "@caustic/react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  useHandlerFailures,
  useLeadSegments,
  useLinkPhase,
  useOpenThreadId,
  useThreadRunning,
  useTransitions,
} from "../../state/engine/index.ts";
import { useCommands } from "../commands.ts";
import { reloadOnExtChanges, useWorkbenchController } from "../workbench/controller.ts";
import { FailureRecords } from "../workbench/ext-detail.tsx";
import { kindText, stateText, stateTone } from "../workbench/ext-row.tsx";
import { HookAnswersContext, HookNoticeList } from "../workbench/hook-notice.tsx";
import {
  DriveStackCards,
  DriveWord,
  type DriveStopControl,
  type DriveWordLook,
} from "../convo/drive-stack.tsx";
import { useDriveStop } from "../convo/drive-frames.ts";
import { driveStackOf, type DriveLeaseFacts } from "../convo/drive-stack-model.ts";
import { useOpenExtensionRecords } from "../extension-records-link.ts";
import { InfoTip } from "../craft/info-tip.tsx";

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

/**
 * 구역 하나: 제목(있으면 그 옆에 정보 아이콘, 사이 4px)과 내용. 제목과 내용 사이 12px.
 * 첫 구역 뒤의 구역은 위에 가는 선과 24px을 두어 구역끼리 묶임이 보이게 한다(lcM6d)
 */
function Section(props: {
  readonly title: string;
  readonly info?: { readonly text: string; readonly label: string };
  readonly divided?: boolean;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <section
      aria-label={props.title}
      className={`grid content-start gap-3 ${props.divided === true ? "border-t border-border-subtle pt-6" : ""}`}
    >
      <h3 className="m-0 flex items-center gap-1 text-ui font-semibold text-text-primary">
        {props.title}
        {props.info === undefined ? null : (
          <InfoTip text={props.info.text} label={props.info.label} />
        )}
      </h3>
      {props.children}
    </section>
  );
}

/** 플러그인 한 줄: 화면 이름과 id(고정폭, 흐리게) */
function Member(props: { readonly member: DriveMemberVM }): ReactNode {
  const { member } = props;
  return (
    <li className="flex min-w-0 items-baseline gap-2 text-ui">
      <span className="min-w-0 truncate text-text-primary">{member.displayName}</span>
      <span className="shrink-0 font-mono text-footnote text-text-tertiary">{member.id}</span>
    </li>
  );
}

/** 플러그인 순서 표의 한 칸: 왼쪽 이름표(h4)와 오른쪽 값. 칸 사이는 가는 선 */
function PluginRow(props: { readonly label: string; readonly children: ReactNode }): ReactNode {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-baseline gap-x-3 px-3 py-2.5">
      <h4 className="m-0 text-footnote font-normal text-text-tertiary">{props.label}</h4>
      <div className="min-w-0">{props.children}</div>
    </div>
  );
}

/** 런타임 탭 Drive 카드가 거울에서 읽는 값(lcM6c): 임대 기록(어떻게 쥐었나, 언제부터, 갈래), 도는 턴, 플러그인 기록으로 가기 */
export type RuntimeDriveExtras = {
  readonly leases: readonly DriveLeaseFacts[];
  readonly running: boolean;
  readonly onOpenRecords: ((plugin: string) => void) | null;
};

function DriveSection(props: {
  readonly view: RuntimeDriveView;
  readonly frames: readonly DriveFrameView[];
  readonly stop: DriveStopControl | null;
  readonly extras: RuntimeDriveExtras | null;
}): ReactNode {
  const { view } = props;
  return (
    <div data-slot="drive-section" className="grid gap-4">
      {!view.holderAgrees && <Alert tone="warning">{t("desktop.runtime.lock.mismatch")}</Alert>}
      {/* 쌓인 판: 맨 위가 지금 Driving 중인 칸의 카드, 아래가 핸드오프하고 기다리는 칸, 맨 아래 "기본"(lcM6b·lcM6c §6.6.1) */}
      <DriveStackCards
        view={driveStackOf(props.frames)}
        stop={props.stop}
        leases={props.extras?.leases ?? []}
        running={props.extras?.running ?? false}
        onOpenRecords={props.extras?.onOpenRecords ?? null}
      />
      {/* 플러그인 순서(lcM6d): 플러그인 목록(group.list)이 말하는 지금 Driving 중인 플러그인, 기다리는 플러그인, 오류가 난 플러그인.
          카드와 16px 떨어진 한 상자 안에서 이름표 | 값 두 칸 표로 묶는다(받은 요청 카드의 정보 줄과 같은 결) */}
      <div
        role="group"
        aria-label={t("desktop.runtime.lock.details")}
        data-slot="drive-plugins"
        className="grid divide-y divide-border-subtle rounded-lg border border-border-subtle"
      >
        <PluginRow label={t("desktop.runtime.lock.holder")}>
          {view.holder === null ? (
            <p className="m-0 text-ui text-text-tertiary">
              {t("desktop.runtime.lock.holder.none")}
            </p>
          ) : (
            <ul className="m-0 grid list-none p-0">
              <Member member={view.holder} />
            </ul>
          )}
        </PluginRow>
        <PluginRow label={t("desktop.runtime.queue.title")}>
          {view.queue.length === 0 ? (
            <p className="m-0 text-ui text-text-tertiary">{t("desktop.runtime.queue.empty")}</p>
          ) : (
            <ul className="m-0 grid list-none gap-1 p-0">
              {view.queue.map((member) => (
                <Member key={member.id} member={member} />
              ))}
            </ul>
          )}
        </PluginRow>
        {view.errored.length > 0 && (
          <PluginRow label={t("desktop.runtime.errored.title")}>
            <ul className="m-0 grid list-none gap-1 p-0">
              {view.errored.map((member) => (
                <Member key={member.id} member={member} />
              ))}
            </ul>
          </PluginRow>
        )}
      </div>
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

/**
 * 역할을 Drive 띠·카드의 상태 글 문법으로(lcM6f: 칩을 없앴다). 쥔 플러그인은 "Driving" 그라데이션 글(물결은 입력창 위 띠만이라 여기는
 * 멈춰 있다), 기다림은 tertiary 글, 오류는 경고색 글이다
 */
const RoleLook: Readonly<Record<Exclude<DriveRoleOf, "none">, DriveWordLook>> = {
  holder: "driving",
  waiting: "quiet",
  error: "warning",
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

/** 구역 안의 목록 상자: 둥금 8, 옅은 테두리, 줄 사이 가는 선(플러그인 순서 표와 같은 결) */
const LIST_BOX =
  "m-0 grid list-none divide-y divide-border-subtle rounded-lg border border-border-subtle p-0";

function TransitionRow(props: { readonly row: TransitionRowVM }): ReactNode {
  const { row } = props;
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-3 py-2 text-ui">
      <span className="font-mono text-footnote text-text-tertiary tabular-nums">{row.time}</span>{" "}
      {row.turn !== null && (
        <>
          <span className="font-mono text-text-tertiary">
            {t("desktop.runtime.transitions.turn", { turn: row.turn })}
          </span>{" "}
        </>
      )}
      <span className="text-text-primary">{t(transitionTextOf(row.change))}</span>{" "}
      <span className="font-mono text-footnote text-text-tertiary">{row.subject}</span>
    </li>
  );
}

/**
 * 켜진 플러그인 한 줄(lcM6d): 첫 줄은 화면 이름(없으면 id), Drive 역할 칩(있을 때), 오른쪽 끝 상태. 둘째 줄은 곁 정보 한 줄
 * "id · 층 · 종류 · 훅 n개"(footnote tertiary). 배지를 줄이고 이름이 앞에 오게 했다
 */
function ExtRow(props: { readonly row: RuntimeExtRowVM }): ReactNode {
  const { row } = props;
  return (
    <li className="grid gap-0.5 px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 truncate text-ui text-text-primary">
          {row.displayName ?? row.name}
        </span>
        {row.drive !== null && row.drive !== "none" && (
          <DriveWord
            look={RoleLook[row.drive]}
            text={t(RoleText[row.drive])}
            slot="runtime-drive-role"
            wave={false}
            className={`text-ui-sm ${row.drive === "holder" ? "font-semibold" : ""}`}
          />
        )}
        <span className="ms-auto shrink-0">
          <StatusDot tone={stateTone(row.state)} label={stateText(row.state)} />
        </span>
      </div>
      <p className="m-0 flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-footnote text-text-tertiary">
        <span className="font-mono">{row.name}</span>
        <span aria-hidden>·</span>
        <span>{row.layer}</span>
        <span aria-hidden>·</span>
        <span>{kindText(row.kind)}</span>
        <span aria-hidden>·</span>
        <span>{t("desktop.runtime.exts.hooks", { count: row.hookCount })}</span>
      </p>
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
  /** Drive 카드의 거울 값. 없으면 카드는 어떻게·언제부터 줄을 비운다 */
  readonly drive?: RuntimeDriveExtras | null;
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
      <ul className={LIST_BOX}>
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
        extras={props.drive ?? null}
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
      <ul className={LIST_BOX}>
        {rows.map((row) => (
          <ExtRow key={row.name} row={row} />
        ))}
      </ul>
    );
  };
  const groups = failureGroupsOf(props.failures);
  return (
    <div className="grid content-start gap-6">
      {props.notices}
      <Section
        title={t("desktop.runtime.section.lock")}
        info={{ text: t("desktop.drive.info"), label: t("desktop.drive.infoLabel") }}
      >
        {driveBody()}
      </Section>
      <Section title={t("desktop.runtime.section.exts")} divided>
        {extsBody()}
      </Section>
      <Section title={t("desktop.runtime.section.transitions")} divided>
        {transitionsBody()}
      </Section>
      <Section title={t("desktop.runtime.section.failures")} divided>
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

/** 열린 대화가 있으면 그 대화의 Drive 멈추기와 카드 값(임대 기록, 도는 턴, 기록으로 가기)을 맨 위 판에 둔다 */
function RuntimeTabLive(props: { readonly threadId: ThreadId }): ReactNode {
  const live = useLinkPhase() === "live";
  const stop = useDriveStop(props.threadId, !live);
  const segments = useLeadSegments(props.threadId);
  const running = useThreadRunning(props.threadId);
  const openRecords = useOpenExtensionRecords();
  const drive = useMemo(
    (): RuntimeDriveExtras => ({ leases: segments, running, onOpenRecords: openRecords }),
    [segments, running, openRecords],
  );
  return <RuntimeTabFor threadId={props.threadId} stop={stop} drive={drive} />;
}

function RuntimeTabFor(props: {
  readonly threadId: ThreadId | null;
  readonly stop?: DriveStopControl | null;
  readonly drive?: RuntimeDriveExtras | null;
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
      drive={props.drive ?? null}
    />
  );
}
