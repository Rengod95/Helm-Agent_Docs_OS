// 대화 영역 오른쪽 "플러그인" 탭 맨 위의 "이 대화에서 끄기" 구역(사용자 결정 A5). 열린 대화의 `ext.list` 행마다 스위치 하나다.
// 행은 그룹 또는 확장 하나이고, 그룹 안 구성원마다 스위치를 두지 않는다. 끄기는 이 대화에만 적용되고 다음 단계 경계에서 바뀐다.
// 시안은 `apps/desktop/mockups/chat-plugin-off`. 값은 `packages/client/src/workbench/thread.ts`가 만든다.
// 데이터: `workbench.list(threadId)`(대화가 열린 연결에서, 확장 목록 알림마다), `workbench.toggleForThread`(스위치를 쓸 때).
import { t, type MessageId } from "@fresnel/client/i18n";
import {
  rowOf,
  threadPendingOf,
  threadSwitchOf,
  threadToggleRequestOf,
  type ThreadLock,
  type ThreadSwitchVM,
} from "@fresnel/client/workbench";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { ExtListEntry } from "@fresnel/contracts/wire";
import { Alert, Badge, Skeleton, Switch, toast, type ToastOptions } from "@caustic/react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLinkPhase, useOpenThreadId } from "../../state/engine/index.ts";
import { useCommands, type WorkbenchCommands } from "../commands.ts";
import { ExtName } from "../workbench/ext-row.tsx";
import { linkOf, type LinkState } from "../runtime/runtime-tab.tsx";
import { detachVoid, reloadOnExtChanges } from "../workbench/controller.ts";

/** 열린 대화의 `ext.list` 한 번 읽기. `idle`은 대화가 없어 읽지 않는다는 뜻이다 */
export type ThreadListLoad =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly entries: readonly ExtListEntry[] };

const LOADING: { readonly kind: "loading" } = { kind: "loading" };
const ERROR: { readonly kind: "error" } = { kind: "error" };
const IDLE: { readonly kind: "idle" } = { kind: "idle" };

/** 안내 한 줄(시안의 intro와 빈 자리 글). 글 역할은 본문 보조다 */
const MUTED = "m-0 text-ui-dense text-text-secondary";
/** 행 아래 캡션 한 줄(잠긴 이유, 적용 대기). 시안의 행 캡션 역할이다 */
const CAPTION = "m-0 text-ui-xs text-text-tertiary";

/** 스위치가 잠긴 이유의 한 줄 글. 전역에서 꺼진 것은 크래프트에서 켜라고 가리킨다 */
const LOCK_TEXT: Readonly<Record<ThreadLock, MessageId>> = {
  no_thread: "desktop.plugin.thread.noThread",
  global_off: "desktop.plugin.thread.globalOff",
  safe_mode: "desktop.workbench.lock.safeMode",
  managed: "desktop.workbench.lock.managed",
};

/** 면제 tier를 뺀 스위치 그림. 행으로 그리는 것은 이것뿐이다 */
type ShownSwitch = Exclude<ThreadSwitchVM, { readonly kind: "hidden" }>;

/** 쓰는 중인 스위치 목표 값. 이름마다 하나다 */
type Showing = Readonly<Record<string, boolean>>;

/** 쓰기가 기대하는 것: 명령, 다시 읽기, 쓰는 중 그림, 토스트. 시험은 가짜로 채운다 */
export interface ThreadSwitchPort {
  readonly commands: Pick<WorkbenchCommands, "toggleForThread">;
  /** 목록을 다시 읽는다. 쓴 뒤에 부른다(실패해도 그 값으로 그린다) */
  readonly reload: () => Promise<ThreadListLoad>;
  /** 쓰는 동안 보일 목표 값을 넣거나(true·false), 뺀다(null) */
  readonly showing: (name: string, target: boolean | null) => void;
  readonly notify: (options: ToastOptions) => void;
}

/**
 * 스위치 하나를 이 대화에 쓴다. 쓰는 동안은 목표 값을 보이고, 끝나면 목록을 다시 읽는다.
 * 실패하면 다시 읽은 원래 값으로 돌아가고 다시 시도 토스트를 띄운다. 성공은 적용 대기가 없을 때만 토스트를 띄운다.
 */
export async function writeThreadSwitch(
  port: ThreadSwitchPort,
  threadId: ThreadId,
  entry: ExtListEntry,
  target: boolean,
): Promise<void> {
  const plan = threadToggleRequestOf(entry, threadId, target);
  if (!plan.ok) return;
  port.showing(entry.name, target);
  const done = await port.commands.toggleForThread(plan.request);
  const after = await port.reload();
  port.showing(entry.name, null);
  if (!done.ok) {
    port.notify({
      tone: "danger",
      title: t("desktop.plugin.thread.failed"),
      actionLabel: t("desktop.plugin.thread.retry"),
      onAction: () => {
        detachVoid(writeThreadSwitch(port, threadId, entry, target));
      },
    });
    return;
  }
  const row = after.kind === "ready" ? after.entries.find((e) => e.name === entry.name) : undefined;
  if (row !== undefined && threadPendingOf(row) !== null) return;
  port.notify({
    tone: "success",
    title: t(target ? "desktop.plugin.thread.done.on" : "desktop.plugin.thread.done.off"),
    description: t("desktop.plugin.thread.appliesNextTurn"),
  });
}

/** 쓰는 중인 값 하나를 넣거나 뺀다. 원래 객체는 바꾸지 않는다 */
function withShowing(current: Showing, name: string, target: boolean | null): Showing {
  const rest = Object.fromEntries(Object.entries(current).filter(([key]) => key !== name));
  return target === null ? rest : { ...rest, [name]: target };
}

/**
 * 열린 대화의 `ext.list`를 읽는다. 연결이 살아 있으면 읽고, 확장 목록 알림마다 다시 읽는다.
 * 읽은 값은 대화와 함께 둔다. 대화가 바뀌면 읽는 중으로 보고, 대화가 없으면 읽지 않는다.
 */
function useThreadList(
  threadId: ThreadId | null,
  live: boolean,
): {
  readonly list: ThreadListLoad;
  readonly reload: () => Promise<ThreadListLoad>;
} {
  const commands = useCommands();
  const key = threadId ?? "";
  const [loaded, setLoaded] = useState<{
    readonly key: string;
    readonly list: ThreadListLoad;
  } | null>(null);
  // 읽기가 겹치면 마지막에 시작한 읽기의 값만 쓴다(먼저 끝난 오래된 값이 새 값을 덮지 않는다)
  const started = useRef(0);
  const reload = useCallback(async (): Promise<ThreadListLoad> => {
    if (threadId === null) return IDLE;
    started.current += 1;
    const attempt = started.current;
    const listed = await commands.workbench.list(threadId);
    const next: ThreadListLoad = listed.ok ? { kind: "ready", entries: listed.value } : ERROR;
    if (attempt === started.current) setLoaded({ key, list: next });
    return next;
  }, [commands, key, threadId]);
  const reloadVoid = useCallback(async (): Promise<void> => {
    await reload();
  }, [reload]);
  useEffect(() => {
    if (!live || threadId === null) return undefined;
    detachVoid(reloadVoid());
    return reloadOnExtChanges(commands.workbench, reloadVoid);
  }, [commands, live, reloadVoid, threadId]);
  return {
    list: loaded !== null && loaded.key === key ? loaded.list : LOADING,
    reload,
  };
}

function Section(props: {
  readonly title: string;
  readonly heading: boolean;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <section
      aria-label={props.title}
      className="grid content-start gap-2 border-b border-border-subtle p-3 pe-12"
    >
      {/* 구역 머리는 시안의 SectionTitle 역할(본문 크기, 굵은 글, 선 없음) */}
      {props.heading && (
        <h3 className="m-0 text-ui-dense font-semibold text-text-primary">{props.title}</h3>
      )}
      {props.children}
    </section>
  );
}

/**
 * 행의 배지. 쓰는 중이거나 경계를 기다리는 동안은 없고(적용 대기는 행 아래 캡션), 열린 대화에서만 꺼졌으면 "꺼짐"이다.
 */
function rowBadge(props: {
  readonly view: ShownSwitch;
  readonly on: boolean;
  readonly pending: boolean;
  readonly writing: boolean;
}): ReactNode {
  if (props.writing || props.pending) return null;
  if (props.view.kind === "open" && !props.on) {
    return <Badge size="sm">{t("desktop.plugin.thread.off")}</Badge>;
  }
  return null;
}

/**
 * 스위치 행 하나. 쓰는 중이거나 경계를 기다리면 잠기고, 잠긴 이유가 있으면 한 줄을 보인다.
 * 구성 요소가 아니라 그리는 함수다. 그래서 `ThreadSwitchesBody`의 요소 트리에 스위치가 바로 들어 있다.
 */
function renderThreadRow(props: {
  readonly entry: ExtListEntry;
  readonly view: ShownSwitch;
  /** 이 행을 쓰는 중이면 목표 값 */
  readonly writing: boolean | undefined;
  readonly onToggle: (entry: ExtListEntry, target: boolean) => void;
}): ReactNode {
  const { entry, view } = props;
  const on = props.writing ?? view.on;
  const pending = threadPendingOf(entry) !== null;
  const busy = props.writing !== undefined || pending;
  return (
    <li
      key={entry.name}
      className="grid gap-1 border-b border-border-subtle py-2.5 last:border-b-0"
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-ui font-medium text-text-primary">
          <ExtName row={rowOf(entry, {})} />
        </span>
        {rowBadge({ view, on, pending, writing: props.writing !== undefined })}
        <Switch
          size="sm"
          checked={on}
          disabled={view.kind === "locked" || busy}
          aria-label={t("desktop.plugin.thread.switch.label", { name: entry.displayName })}
          onCheckedChange={(target) => {
            props.onToggle(entry, target);
          }}
        />
      </div>
      {view.kind === "locked" && <p className={CAPTION}>{t(LOCK_TEXT[view.lock])}</p>}
      {pending && props.writing === undefined && (
        <span role="status" className={CAPTION}>
          {t("desktop.plugin.thread.appliesAt")}
        </span>
      )}
    </li>
  );
}

/**
 * 이 대화에서 끄기 구역의 그림. 대화가 없으면 한 줄이고, 연결이 끊기면 끊김 글 한 줄이다.
 * 목록을 읽는 중이면 Skeleton, 읽기가 실패하면 오류 한 줄이다. 면제 tier 행은 그리지 않는다.
 */
export function ThreadSwitchesBody(props: {
  readonly threadOpen: boolean;
  readonly link: LinkState;
  readonly list: ThreadListLoad;
  /** 쓰는 중인 스위치의 목표 값 */
  readonly showing: Showing;
  readonly onToggle: (entry: ExtListEntry, target: boolean) => void;
  /** 구역 제목을 그리는가. 접는 줄이 제목을 이미 보이면 거짓이다. 기본은 참 */
  readonly heading?: boolean;
}): ReactNode {
  const heading = props.heading !== false;
  const title = t("desktop.plugin.thread.title");
  if (!props.threadOpen) {
    return (
      <Section title={title} heading={heading}>
        <p className={MUTED}>{t("desktop.plugin.thread.noThread")}</p>
      </Section>
    );
  }
  if (props.link === "offline") {
    return (
      <Section title={title} heading={heading}>
        <p className={MUTED}>{t("desktop.runtime.offline")}</p>
      </Section>
    );
  }
  const list = props.list;
  if (list.kind === "error") {
    return (
      <Section title={title} heading={heading}>
        <Alert tone="danger" layout="inline">
          {t("desktop.plugin.thread.loadFailed")}
        </Alert>
      </Section>
    );
  }
  if (list.kind !== "ready") {
    return (
      <Section title={title} heading={heading}>
        <Skeleton height={24} />
      </Section>
    );
  }
  const rows = list.entries.flatMap((entry) => {
    const view = threadSwitchOf(entry, props.threadOpen);
    return view.kind === "hidden" ? [] : [{ entry, view }];
  });
  if (rows.length === 0) {
    return (
      <Section title={title} heading={heading}>
        <p className={MUTED}>{t("desktop.plugin.thread.empty")}</p>
      </Section>
    );
  }
  return (
    <Section title={title} heading={heading}>
      <p className={MUTED}>{t("desktop.plugin.thread.intro")}</p>
      <ul className="m-0 grid list-none p-0">
        {rows.map(({ entry, view }) =>
          renderThreadRow({
            entry,
            view,
            writing: props.showing[entry.name],
            onToggle: props.onToggle,
          }),
        )}
      </ul>
    </Section>
  );
}

/** 대화 영역 "플러그인" 탭의 이 대화에서 끄기 구역. 열린 대화의 확장마다 스위치 하나를 그린다 */
export function ThreadSwitches(props: { readonly heading?: boolean }): ReactNode {
  const commands = useCommands();
  const threadId = useOpenThreadId();
  const link = linkOf(useLinkPhase());
  const { list, reload } = useThreadList(threadId, link === "live");
  const [showing, setShowing] = useState<Showing>({});
  const onToggle = (entry: ExtListEntry, target: boolean): void => {
    if (threadId === null) return;
    const port: ThreadSwitchPort = {
      commands: commands.workbench,
      reload,
      showing: (name, next) => {
        setShowing((current) => withShowing(current, name, next));
      },
      notify: (options) => {
        toast(options);
      },
    };
    detachVoid(writeThreadSwitch(port, threadId, entry, target));
  };
  return (
    <ThreadSwitchesBody
      threadOpen={threadId !== null}
      link={link}
      list={list}
      showing={showing}
      onToggle={onToggle}
      heading={props.heading !== false}
    />
  );
}
