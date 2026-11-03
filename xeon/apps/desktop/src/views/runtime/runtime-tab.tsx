// 런타임 탭(대화 영역 오른쪽 "런타임", spec §4.9.8). 구역 넷: 주도 락, 켜진 그룹과 확장, 전환 기록, 실패.
// 데이터는 열린 대화 하나를 따라 읽는다(`ext.list`, `group.list`, `group.driveLock`). 목록 알림(`reloadOnExtChanges`)마다 다시 읽는다.
// 모양은 `RuntimeBody`가 그린다. 값은 `packages/client/src/workbench/runtime.ts`의 모델이 만든다.
import { t, type MessageId } from "@fresnel/client/i18n";
import {
  failureGroupsOf,
  runtimeRowsOf,
  runtimeViewOf,
  type DriveMemberVM,
  type DriveRoleOf,
  type HandlerFailureEntry,
  type RuntimeDriveView,
  type RuntimeExtRowVM,
} from "@fresnel/client/workbench";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { detach, rethrow } from "@fresnel/contracts";
import type { ExtListEntry, GroupDriveLockResult, GroupStatusWire } from "@fresnel/contracts/wire";
import { Alert, Badge, Skeleton, StatusDot } from "@caustic/react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useHandlerFailures, useLinkPhase, useOpenThreadId } from "../../state/engine/index.ts";
import { useCommands } from "../commands.ts";
import { reloadOnExtChanges } from "../workbench/controller.ts";
import { FailureRecords } from "../workbench/ext-detail.tsx";
import { kindText, stateText, stateTone } from "../workbench/ext-row.tsx";

/** 한 묶음의 읽기 상태 */
export type Load<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly value: T };

/** drive 구역의 읽은 값: 그룹 목록과 대화의 drive 락 */
interface DriveData {
  readonly groups: readonly GroupStatusWire[];
  readonly lock: GroupDriveLockResult;
}

/** 탭이 읽는 값 전부. 연결이 없으면 `offline`이라 읽지 않는다 */
export interface RuntimeData {
  readonly entries: Load<readonly ExtListEntry[]>;
  readonly drive: Load<DriveData>;
}

const LOADING: RuntimeData = { entries: { kind: "loading" }, drive: { kind: "loading" } };

/**
 * 열린 대화의 런타임 값을 읽는다. 대화가 바뀌거나 연결이 서면 다시 읽고, 확장 목록 알림마다 다시 읽는다.
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
      const [entries, groups, lock] = await Promise.all([
        commands.workbench.list(threadId),
        commands.workbench.groups(threadId),
        commands.workbench.driveLock(threadId),
      ]);
      if (!active) return;
      setLoaded({
        key,
        data: {
          entries: entries.ok ? { kind: "ready", value: entries.value } : { kind: "error" },
          drive:
            groups.ok && lock.ok
              ? { kind: "ready", value: { groups: groups.value, lock: lock.value } }
              : { kind: "error" },
        },
      });
    };
    detach(load(), rethrow);
    const off = reloadOnExtChanges(commands.workbench, load);
    return () => {
      active = false;
      off();
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
      <h3 className="m-0 text-ui-sm font-semibold text-text-primary">{props.title}</h3>
      {props.children}
    </section>
  );
}

function Member(props: { readonly member: DriveMemberVM }): ReactNode {
  const { member } = props;
  return (
    <li className="flex flex-wrap items-center gap-2 text-ui-sm">
      <span className="text-text-primary">{member.displayName}</span>
      <span className="font-mono text-text-tertiary">{member.id}</span>
      {member.waits !== null && member.waitLimit !== null && (
        <span className="ms-auto text-text-tertiary">
          {t("desktop.runtime.queue.waits", { waits: member.waits, waitLimit: member.waitLimit })}
        </span>
      )}
    </li>
  );
}

/** 턴·spawn·토큰 사용량 한 줄. 토큰 상한이 없으면 사용량만 보인다 */
export function driveUsageText(view: RuntimeDriveView): string {
  const { limits, used } = view;
  return limits.tokens === null
    ? t("desktop.runtime.lock.usage.noTokenLimit", {
        turns: used.turns,
        turnsLimit: limits.turns,
        spawns: used.spawns,
        spawnsLimit: limits.spawns,
        tokens: used.tokens,
      })
    : t("desktop.runtime.lock.usage", {
        turns: used.turns,
        turnsLimit: limits.turns,
        spawns: used.spawns,
        spawnsLimit: limits.spawns,
        tokens: used.tokens,
        tokensLimit: limits.tokens,
      });
}

function DriveSection(props: { readonly view: RuntimeDriveView }): ReactNode {
  const { view } = props;
  const usage = driveUsageText(view);
  return (
    <div className="grid gap-2">
      {!view.holderAgrees && <Alert tone="warning">{t("desktop.runtime.lock.mismatch")}</Alert>}
      <p className="m-0 flex flex-wrap items-center gap-2 text-ui-sm">
        <span className="text-text-tertiary">{t("desktop.runtime.lock.holder")}</span>
        {view.holder === null ? (
          <span className="text-text-tertiary">{t("desktop.runtime.lock.holder.none")}</span>
        ) : (
          <>
            <span className="text-text-primary">{view.holder.displayName}</span>
            <span className="font-mono text-text-tertiary">{view.holder.id}</span>
          </>
        )}
        <span className="ms-auto font-mono text-text-tertiary">
          {t("desktop.runtime.lock.epoch", { epoch: view.leaseEpoch })}
        </span>
      </p>
      <p className="m-0 text-ui-sm text-text-tertiary">{usage}</p>
      <p className="m-0 text-ui-sm text-text-tertiary">
        {view.activeDriver === null
          ? t("desktop.runtime.lock.activeDriver.auto")
          : t("desktop.runtime.lock.activeDriver", { name: view.activeDriver })}
      </p>
      <div className="grid gap-1">
        <h4 className="m-0 text-ui-sm font-medium text-text-secondary">
          {t("desktop.runtime.queue.title")}
        </h4>
        {view.queue.length === 0 ? (
          <p className="m-0 text-ui-sm text-text-tertiary">{t("desktop.runtime.queue.empty")}</p>
        ) : (
          <ul className="m-0 grid list-none gap-1 p-0">
            {view.queue.map((member) => (
              <Member key={member.id} member={member} />
            ))}
          </ul>
        )}
      </div>
      <div className="grid gap-1">
        <h4 className="m-0 text-ui-sm font-medium text-text-secondary">
          {t("desktop.runtime.rejected.title")}
        </h4>
        {view.rejected.length === 0 ? (
          <p className="m-0 text-ui-sm text-text-tertiary">{t("desktop.runtime.rejected.empty")}</p>
        ) : (
          <ul className="m-0 grid list-none gap-1 p-0">
            {view.rejected.map((member) => (
              <Member key={member.id} member={member} />
            ))}
          </ul>
        )}
      </div>
      {view.errored.length > 0 && (
        <div className="grid gap-1">
          <h4 className="m-0 text-ui-sm font-medium text-text-secondary">
            {t("desktop.runtime.errored.title")}
          </h4>
          <ul className="m-0 grid list-none gap-1 p-0">
            {view.errored.map((member) => (
              <Member key={member.id} member={member} />
            ))}
          </ul>
        </div>
      )}
      {view.lastRejected !== null && (
        <p className="m-0 text-ui-sm text-text-tertiary">
          {t("desktop.runtime.lock.lastRejected", {
            group: view.lastRejected.groupId,
            reason: view.lastRejected.reason,
            seq: view.lastRejected.requestSeq,
          })}
        </p>
      )}
    </div>
  );
}

/** 그룹 역할의 글. 역할 값마다 메시지 id 하나다(템플릿으로 만들지 않는다) */
export const RoleText: Readonly<Record<DriveRoleOf, MessageId>> = {
  holder: "desktop.runtime.role.holder",
  waiting: "desktop.runtime.role.waiting",
  rejected: "desktop.runtime.role.rejected",
  error: "desktop.runtime.role.error",
  none: "desktop.runtime.role.none",
};

function ExtRow(props: { readonly row: RuntimeExtRowVM }): ReactNode {
  const { row } = props;
  return (
    <li className="grid gap-1 rounded-md px-2 py-1.5 text-ui-sm">
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
 */
export function RuntimeBody(props: {
  readonly threadId: ThreadId | null;
  readonly link: LinkState;
  readonly data: RuntimeData;
  readonly failures: readonly HandlerFailureEntry[];
}): ReactNode {
  const { data, link } = props;
  const noThread = props.threadId === null;
  const driveBody = (): ReactNode => {
    if (noThread)
      return (
        <p className="m-0 text-ui-sm text-text-tertiary">{t("desktop.runtime.empty.thread")}</p>
      );
    if (link === "offline")
      return <p className="m-0 text-ui-sm text-text-tertiary">{t("desktop.runtime.offline")}</p>;
    if (link === "pending" || data.drive.kind === "loading") return <Skeleton height={48} />;
    if (data.drive.kind === "error")
      return <Alert tone="danger">{t("desktop.runtime.lock.failed")}</Alert>;
    const { groups, lock } = data.drive.value;
    return <DriveSection view={runtimeViewOf(groups, lock)} />;
  };
  const extsBody = (): ReactNode => {
    if (noThread) return null;
    if (link === "offline")
      return <p className="m-0 text-ui-sm text-text-tertiary">{t("desktop.runtime.offline")}</p>;
    if (link === "pending" || data.entries.kind === "loading") return <Skeleton height={48} />;
    if (data.entries.kind === "error")
      return <Alert tone="danger">{t("desktop.runtime.exts.failed")}</Alert>;
    const groups = data.drive.kind === "ready" ? data.drive.value.groups : [];
    const rows = runtimeRowsOf(data.entries.value, groups);
    if (rows.length === 0)
      return <p className="m-0 text-ui-sm text-text-tertiary">{t("desktop.runtime.exts.empty")}</p>;
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
      <Section title={t("desktop.runtime.section.lock")}>{driveBody()}</Section>
      <Section title={t("desktop.runtime.section.exts")}>{extsBody()}</Section>
      <Section title={t("desktop.runtime.section.transitions")}>
        <p className="m-0 text-ui-sm text-text-tertiary">
          {t("desktop.runtime.transitions.unavailable")}
        </p>
      </Section>
      <Section title={t("desktop.runtime.section.failures")}>
        {groups.length === 0 ? (
          <p className="m-0 text-ui-sm text-text-tertiary">{t("desktop.runtime.failures.empty")}</p>
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

/** 런타임 탭. 열린 대화와 엔진 연결을 읽어 `RuntimeBody`에 넘긴다 */
export function RuntimeTab(): ReactNode {
  const threadId = useOpenThreadId();
  const link = linkOf(useLinkPhase());
  const data = useRuntimeData(threadId, link === "live");
  const failures = useHandlerFailures();
  return <RuntimeBody threadId={threadId} link={link} data={data} failures={failures} />;
}
