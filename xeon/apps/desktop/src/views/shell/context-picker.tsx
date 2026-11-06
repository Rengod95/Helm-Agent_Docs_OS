// 작업대 영역의 맥락 칸(§4.9.3, V-25). 값 하나가 모든 작업대 화면의 맥락을 정한다: 전체·대화·프로필·시험.
// 대화 값은 기본으로 대화 영역에서 열린 대화를 따라가고, 자물쇠로 고정·풀기를 한다.
import { t } from "@fresnel/client/i18n";
import type { ThreadSummary } from "@fresnel/contracts/wire";
import {
  IconButton,
  Select,
  SelectGroup,
  SelectHeading,
  SelectOption,
  Tooltip,
} from "@caustic/react";
import { Lock, LockOpen, MessageSquare } from "@caustic/react/icons";
import type { ReactNode } from "react";
import { useThreadSummaries } from "../../state/engine/index.ts";
import { useShell, useShellActions, type WorkbenchContext } from "../../state/shell/index.ts";
import { contextThreadGroupsOf } from "../thread-groups.ts";

/** 프로필 목록은 프로필 화면 트랙(T-BENCH)이 채운다. 셸은 그 값을 받아 칸에 올릴 뿐이다 */
export interface ContextProfile {
  readonly id: string;
  readonly title: string;
}

/** 칸의 대화 항목 값: id와 보일 이름(제목이 없으면 "제목 없음") */
function namedThreads(list: readonly ThreadSummary[]): { id: string; title: string }[] {
  return list.map((th) => ({
    id: th.threadId,
    title: th.title ?? t("desktop.threads.untitled"),
  }));
}

function encodeContext(c: WorkbenchContext): string {
  if (c.kind === "all") return "all";
  if (c.kind === "profile") return `profile:${c.profileId}`;
  return `${c.kind}:${c.threadId}`;
}

/** Select 값(`all`, `thread:<id>`, `profile:<id>`, `trial:<id>`)을 맥락 종류와 id로 푼다 */
function decodeContext(value: string): { kind: WorkbenchContext["kind"]; id?: string } {
  const sep = value.indexOf(":");
  if (sep < 0) return { kind: "all" };
  const kind = value.slice(0, sep);
  const id = value.slice(sep + 1);
  if (kind === "thread" || kind === "profile" || kind === "trial") return { kind, id };
  return { kind: "all" };
}

export function ContextPicker(props: {
  readonly profiles: readonly ContextProfile[];
  readonly onGoToThread: (threadId: string) => void;
}): ReactNode {
  const context = useShell((s) => s.context);
  const actions = useShellActions();
  const threads = useThreadSummaries();
  const groups = contextThreadGroupsOf(threads);
  const plain = namedThreads(groups.threads);
  const trials = namedThreads(groups.trials);
  return (
    <div className="flex min-w-0 items-center gap-1">
      <Select
        size="xs"
        variant="soft"
        aria-label={t("desktop.shell.context.label")}
        value={encodeContext(context)}
        onValueChange={(value) => {
          const next = decodeContext(value);
          // 칸에서 대화를 직접 고르면 그 대화로 고정된다. 따라가기는 자물쇠를 풀어서 돌아온다
          if (next.kind === "thread" && next.id !== undefined) actions.pinThread(next.id);
          else actions.setContextKind(next.kind, next.id);
        }}
        className="min-w-0 flex-1"
      >
        <SelectOption value="all">
          {t("desktop.shell.context.label")} · {t("desktop.shell.context.all")}
        </SelectOption>
        <SelectGroup>
          <SelectHeading>{t("desktop.shell.context.thread")}</SelectHeading>
          {plain.map((th) => (
            <SelectOption key={th.id} value={`thread:${th.id}`}>
              {context.kind === "thread" && context.threadId === th.id
                ? `${t("desktop.shell.context.thread")} · ${th.title}`
                : th.title}
            </SelectOption>
          ))}
        </SelectGroup>
        {props.profiles.length === 0 ? null : (
          <SelectGroup>
            <SelectHeading>{t("desktop.shell.context.profile")}</SelectHeading>
            {props.profiles.map((p) => (
              <SelectOption key={p.id} value={`profile:${p.id}`}>
                {context.kind === "profile" && context.profileId === p.id
                  ? `${t("desktop.shell.context.profile")} · ${p.title}`
                  : p.title}
              </SelectOption>
            ))}
          </SelectGroup>
        )}
        {trials.length === 0 ? null : (
          <SelectGroup>
            <SelectHeading>{t("desktop.shell.context.trial")}</SelectHeading>
            {trials.map((th) => (
              <SelectOption key={th.id} value={`trial:${th.id}`}>
                {context.kind === "trial" && context.threadId === th.id
                  ? `${t("desktop.shell.context.trial")} · ${th.title}`
                  : th.title}
              </SelectOption>
            ))}
          </SelectGroup>
        )}
      </Select>
      {context.kind === "thread" ? (
        <Tooltip
          content={
            context.pinned ? t("desktop.shell.context.unpin") : t("desktop.shell.context.pin")
          }
        >
          <IconButton
            size="md"
            variant="ghost"
            label={
              context.pinned
                ? t("desktop.shell.context.unpinLabel")
                : t("desktop.shell.context.pinLabel")
            }
            // 고정이면 옅은 바탕 하나로 말한다(토글 모양은 caustic이 잉크 면으로 칠해 너무 세다)
            className={context.pinned ? "bg-fill-hover text-text-primary" : undefined}
            onClick={() => {
              if (context.pinned) actions.unpinThread();
              else actions.pinThread(context.threadId);
            }}
          >
            {context.pinned ? <Lock emphasis="selected" /> : <LockOpen emphasis="muted" />}
          </IconButton>
        </Tooltip>
      ) : null}
      {context.kind === "thread" || context.kind === "trial" ? (
        <IconButton
          size="md"
          variant="ghost"
          label={t("desktop.shell.context.goToThread")}
          onClick={() => {
            props.onGoToThread(context.threadId);
          }}
        >
          <MessageSquare />
        </IconButton>
      ) : null}
    </div>
  );
}
