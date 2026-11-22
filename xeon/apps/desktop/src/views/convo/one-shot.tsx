import { Chip, IconButton } from "@caustic/react";
import { Compass, SlashSquare, SquareDashed, X } from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { DraftInfo, InvocableEntry } from "@fresnel/contracts/wire";
import { useEffect, useState, type ReactNode } from "react";
import type { TurnInvokedRecord } from "../../state/engine/convo.ts";
import { useCommands } from "../commands.ts";
import { draftPluginsOf, type OneShotPick } from "./one-shot-model.ts";
import { MetaParts } from "../meta-parts.tsx";

// 원샷 부품(lcM6a, L4 desktop-ux §6.6.1, craft-flows T2):
// - 슬래시 목록의 "원샷" 묶음 행(`OneShotRow`)
// - 고른 원샷 칩 줄(`OneShotChips`, 입력창 바로 위): 지울 수 있다. Drive가 끝날 때까지 남은 원샷은 지울 수 없는 칩으로 같이 선다
// - 턴 발 줄의 표지(`InvokedMark`): 그 턴에 얹힌 원샷 이름, 드래프트면 그 표시
// 아이콘: 원샷 빗금 사각형, 드래프트 점선 사각형, Drive까지 남는 원샷은 나침반(강조색).

/** 원샷 목록의 읽은 값. 목록을 못 읽으면 `failed`이고 친 글은 풀지 않는다 */
export type OneShotSource =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | {
      readonly kind: "ready";
      readonly entries: readonly InvocableEntry[];
      readonly inSet: ReadonlySet<string>;
      readonly drafts: ReadonlyMap<string, readonly DraftInfo[]>;
    };

/**
 * `/`를 친 동안(`active`) 원샷 목록을 읽는다: `plugin.invocables`, 프로필에 든 플러그인(`plugin.list`), 플러그인마다 드래프트
 * (`plugin.draft.list`, 상한 `DRAFT_PLUGINS_MAX`). 드래프트를 못 읽은 플러그인은 드래프트 없이 둔다
 */
export function useOneShotSource(
  threadId: ThreadId,
  profileId: string,
  active: boolean,
): OneShotSource {
  const commands = useCommands();
  const [source, setSource] = useState<{
    readonly key: string;
    readonly value: OneShotSource;
  } | null>(null);
  const key = `${threadId}\n${profileId}`;
  useEffect(() => {
    if (!active) return undefined;
    const run = { live: true };
    // 기다린 뒤마다 다시 본다(함수로 읽어야 앞의 검사로 좁혀지지 않는다)
    const gone = (): boolean => !run.live;
    const load = async (): Promise<void> => {
      const [entries, inSet] = await Promise.all([
        commands.workbench.invocables(threadId),
        commands.workbench.pluginsInProfile(profileId),
      ]);
      if (gone()) return;
      if (!entries.ok || !inSet.ok) {
        setSource({ key, value: { kind: "failed" } });
        return;
      }
      const names = draftPluginsOf(entries.value);
      const listed = await Promise.all(names.map((name) => commands.workbench.drafts(name)));
      if (gone()) return;
      const drafts = new Map<string, readonly DraftInfo[]>();
      names.forEach((name, index) => {
        const got = listed[index];
        if (got?.ok === true && got.value.length > 0) drafts.set(name, got.value);
      });
      setSource({
        key,
        value: { kind: "ready", entries: entries.value, inSet: inSet.value, drafts },
      });
    };
    detach(load(), rethrow);
    return () => {
      run.live = false;
    };
  }, [active, commands, key, profileId, threadId]);
  if (source !== null && source.key === key) return source.value;
  return active ? { kind: "loading" } : { kind: "idle" };
}

function PickIcon(props: { readonly pick: Pick<OneShotPick, "draftId" | "until"> }): ReactNode {
  if (props.pick.draftId !== null) {
    return <SquareDashed aria-hidden className="size-3.5 shrink-0 text-warning-text" />;
  }
  if (props.pick.until === "release") {
    return <Compass aria-hidden className="size-3.5 shrink-0 text-accent-text" />;
  }
  return <SlashSquare aria-hidden className="size-3.5 shrink-0 text-text-tertiary" />;
}

/** 원샷이 남는 범위와 드래프트 표시 */
function scopeTextOf(pick: Pick<OneShotPick, "draftId" | "until">): ReactNode {
  const scope =
    pick.until === "release" ? t("desktop.oneShot.untilDrive") : t("desktop.oneShot.turnOnly");
  return pick.draftId === null ? (
    scope
  ) : (
    <span className="inline-flex min-w-0 flex-wrap items-baseline gap-2">
      <span>{t("desktop.oneShot.draft")}</span> <span>{t("desktop.oneShot.draftHint")}</span>
    </span>
  );
}

/** 슬래시 목록의 원샷 행. 이름 뒤에 플러그인, 범위(이 턴만 / Drive가 끝날 때까지), 드래프트면 그 표시 */
export function OneShotRow(props: {
  readonly id: string;
  readonly pick: OneShotPick;
  readonly selected: boolean;
  readonly onPick: () => void;
  readonly onHover: () => void;
}): ReactNode {
  const { pick } = props;
  return (
    <li
      id={props.id}
      role="option"
      aria-selected={props.selected}
      data-one-shot={pick.draftId === null ? pick.until : "draft"}
      className="flex cursor-default items-center gap-2 rounded-xl px-2.5 py-1.5 text-ui text-text-secondary aria-selected:bg-neutral-hover aria-selected:text-text-primary"
      onMouseDown={(event) => {
        event.preventDefault();
        props.onPick();
      }}
      onMouseEnter={() => {
        props.onHover();
      }}
    >
      <PickIcon pick={pick} />
      <span className="text-ui-strong text-text-primary">/{pick.name}</span>
      {pick.whole ? null : <span className="text-text-tertiary">{pick.plugin}</span>}
      {pick.draftId === null ? null : (
        <Chip size="xs" variant="outline" tone="warning">
          {t("desktop.oneShot.draft")}
        </Chip>
      )}
      <span className="min-w-0 truncate">{pick.title === pick.name ? "" : pick.title}</span>
      <span className="ms-auto shrink-0 text-footnote text-text-tertiary">
        {pick.draftId === null ? scopeTextOf(pick) : t("desktop.oneShot.draftHint")}
      </span>
    </li>
  );
}

/** Drive가 끝날 때까지 얹힌 원샷(지금 대화에 걸린 덧씌우기) */
export type LiveOneShot = { readonly plugin: string; readonly draft: boolean };

/**
 * 입력창 바로 위 칩 줄. 이번 턴에 얹을 원샷(지울 수 있음)과, Drive가 끝날 때까지 남은 원샷(지울 수 없음)을 같이 보인다.
 * 둘 다 없으면 그리지 않는다
 */
export function OneShotChips(props: {
  readonly picks: readonly OneShotPick[];
  readonly live: readonly LiveOneShot[];
  readonly onRemove: (key: string) => void;
}): ReactNode {
  if (props.picks.length === 0 && props.live.length === 0) return null;
  return (
    <ul
      aria-label={t("desktop.oneShot.chipsLabel")}
      data-slot="one-shot-chips"
      className="m-0 flex list-none flex-wrap items-center gap-1.5 px-1 py-0"
    >
      {props.live.map((live) => (
        <li
          key={`live:${live.plugin}`}
          data-one-shot-live
          aria-label={t("desktop.oneShot.liveAria", { name: live.plugin })}
          className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-ui text-text-secondary shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)]"
        >
          <PickIcon pick={{ draftId: live.draft ? "live" : null, until: "release" }} />
          <span className="text-text-primary">
            {t("desktop.oneShot.live", { name: live.plugin })}
          </span>
          <span className="text-footnote text-text-tertiary">
            {t("desktop.oneShot.untilDrive")}
          </span>
        </li>
      ))}
      {props.picks.map((pick) => (
        <li
          key={pick.key}
          data-one-shot-pick={pick.draftId === null ? pick.until : "draft"}
          className="flex h-7 items-center gap-1.5 rounded-lg ps-2 pe-0.5 text-ui text-text-secondary shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)]"
        >
          <PickIcon pick={pick} />
          <span className="text-text-primary">/{pick.name}</span>
          <span className="text-footnote text-text-tertiary">{scopeTextOf(pick)}</span>
          <IconButton
            type="button"
            size="xs"
            variant="ghost"
            label={t("desktop.oneShot.remove", { name: pick.name })}
            onClick={() => {
              props.onRemove(pick.key);
            }}
          >
            <X aria-hidden />
          </IconButton>
        </li>
      ))}
    </ul>
  );
}

/** 턴 발 줄의 원샷 표지: "/review · /plugin" 앞에 원샷 아이콘. 드래프트가 있으면 점선 사각형과 "드래프트" */
export function InvokedMark(props: { readonly invoked: readonly TurnInvokedRecord[] }): ReactNode {
  const shown = props.invoked.filter((item) => item.kind !== "drive");
  if (shown.length === 0) return null;
  const draft = shown.some((item) => item.draft);
  const names = shown.map((item) => `/${item.entry}`);
  return (
    <span
      data-slot="turn-one-shot"
      aria-label={t("desktop.oneShot.traceAria", { names: names.join(", ") })}
      className="convo-line-meta flex items-center gap-1 px-1.5"
    >
      {draft ? (
        <SquareDashed aria-hidden className="size-3 shrink-0 text-warning-text" />
      ) : (
        <SlashSquare aria-hidden className="size-3 shrink-0" />
      )}
      <span aria-hidden className="flex min-w-0 flex-wrap items-baseline gap-2">
        <MetaParts parts={[t("desktop.oneShot.group"), ...names]} />
        {draft ? (
          <>
            {" "}
            <span>{t("desktop.oneShot.draft")}</span>
          </>
        ) : null}
      </span>
    </span>
  );
}
