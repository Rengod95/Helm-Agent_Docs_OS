// 대화 영역 오른쪽 "플러그인" 탭 맨 위의 "이 대화의 플러그인" 구역. 열린 대화의 `ext.list` 행마다 한 줄이다.
// M5c-1부터 켜짐은 이 대화가 참조하는 프로필과 공통 묶음에서 계산한다(docs/xeon/review/m5/profile-project-loader.md §3.4).
// 그래서 대화별 켜기·끄기 스위치는 없고 이 구역은 읽기만 한다. 바꾸려면 "이 대화의 프로필" 구역에서 프로필을 고른다.
// 값은 `packages/client/src/workbench/thread.ts`가 만든다. 데이터: `workbench.list(threadId)`(대화가 열린 연결에서, 확장 목록 알림마다).
import { t, type MessageId } from "@fresnel/client/i18n";
import { isExemptTier, rowOf, threadOnOf, threadPendingOf } from "@fresnel/client/workbench";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { ExtListEntry } from "@fresnel/contracts/wire";
import { Alert, Badge, Skeleton } from "@caustic/react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLinkPhase, useOpenThreadId } from "../../state/engine/index.ts";
import { useCommands } from "../commands.ts";
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
/** 행 아래 캡션 한 줄(적용 대기). 시안의 행 캡션 역할이다 */
const CAPTION = "m-0 text-ui text-text-tertiary";

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

/** 행 하나. 이 대화에서 꺼졌으면 "꺼짐" 배지, 경계를 기다리는 중이면 적용 대기 캡션을 보인다. 조작은 없다 */
function renderThreadRow(entry: ExtListEntry): ReactNode {
  const pending = threadPendingOf(entry) !== null;
  const on = threadOnOf(entry);
  return (
    <li
      key={entry.name}
      className="grid gap-1 border-b border-border-subtle py-2.5 last:border-b-0"
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-ui font-medium text-text-primary">
          <ExtName row={rowOf(entry, {})} />
        </span>
        {!pending && !on ? <Badge size="sm">{t("desktop.plugin.thread.off")}</Badge> : null}
      </div>
      {pending ? (
        <span role="status" className={CAPTION}>
          {t("desktop.plugin.thread.appliesAt")}
        </span>
      ) : null}
    </li>
  );
}

/**
 * 이 대화의 플러그인 구역의 그림. 대화가 없으면 한 줄이고, 연결이 끊기면 끊김 글 한 줄이다.
 * 목록을 읽는 중이면 Skeleton, 읽기가 실패하면 오류 한 줄이다. 면제 tier 행은 그리지 않는다.
 */
export function ThreadSwitchesBody(props: {
  readonly threadOpen: boolean;
  readonly link: LinkState;
  readonly list: ThreadListLoad;
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
  const rows = list.entries.filter((entry) => !isExemptTier(entry));
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
      <ul className="m-0 grid list-none p-0">{rows.map(renderThreadRow)}</ul>
    </Section>
  );
}

/** 대화 영역 "플러그인" 탭의 이 대화의 플러그인 구역. 열린 대화의 확장마다 한 줄이고 읽기만 한다 */
export function ThreadSwitches(props: { readonly heading?: boolean }): ReactNode {
  const threadId = useOpenThreadId();
  const link = linkOf(useLinkPhase());
  const { list } = useThreadList(threadId, link === "live");
  return (
    <ThreadSwitchesBody
      threadOpen={threadId !== null}
      link={link}
      list={list}
      heading={props.heading !== false}
    />
  );
}

/** 플러그인 하나의 이 대화에서의 상태 그림(플레이그라운드 상세가 한 줄로 그린다). 읽기만 한다 */
export type ThreadSwitchOne =
  /** 대화가 없거나 연결이 없거나 읽는 중·실패, 또는 면제 tier라 보이지 않는다. `note`는 아래 줄 글 */
  | { readonly kind: "none"; readonly note: MessageId | undefined }
  | { readonly kind: "state"; readonly on: boolean; readonly note: MessageId | undefined };

/**
 * 열린 대화에서 확장 `name` 하나의 상태. `ThreadSwitches`와 같은 읽기(`ext.list`)를 쓴다.
 * 행으로 그릴 것이 없으면 `none`과 그 이유다
 */
export function useThreadSwitchOf(name: string): ThreadSwitchOne {
  const threadId = useOpenThreadId();
  const link = linkOf(useLinkPhase());
  const { list } = useThreadList(threadId, link === "live");
  if (threadId === null) return { kind: "none", note: "desktop.addons.thread.noThread" };
  if (link === "offline") return { kind: "none", note: "desktop.runtime.offline" };
  if (list.kind === "error") return { kind: "none", note: "desktop.plugin.thread.loadFailed" };
  if (list.kind !== "ready") return { kind: "none", note: undefined };
  const entry = list.entries.find((item) => item.name === name);
  if (entry === undefined || isExemptTier(entry)) return { kind: "none", note: undefined };
  return {
    kind: "state",
    on: threadOnOf(entry),
    note: threadPendingOf(entry) !== null ? "desktop.plugin.thread.appliesAt" : undefined,
  };
}
