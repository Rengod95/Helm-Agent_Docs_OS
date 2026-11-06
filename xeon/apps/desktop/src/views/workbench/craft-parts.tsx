// 개요와 확장 화면이 같이 쓰는 부품: 목록 상태 띠(읽는 중·오류·오프라인)와 켜기 요청, 자동 꺼짐 알림(플러그인 카드와 오른쪽 "플러그인" 탭).
// 찾기 막대와 개수 줄은 확장 화면이 쓴다.
import { t } from "@fresnel/client/i18n";
import { countsOf, keepOffOf, type HookNotice } from "@fresnel/client/workbench";
import { Alert, Button, Input, Skeleton } from "@caustic/react";
import { Bug } from "@fresnel/contracts";
import type { ExtListEntry } from "@fresnel/contracts/wire";
import { createContext, useContext, useState, type ReactNode } from "react";
import { useLinkPhase } from "../../state/engine/index.ts";
import { useWorkbench, useWorkbenchActions } from "../../state/workbench/index.ts";
import { detachVoid, type WorkbenchController } from "./controller.ts";
import { needsTrustConfirm, TrustDialog } from "./trust-dialog.tsx";

/** 켜기 요청. 꺼져 있던 user·project 확장을 켜면 O-10을 먼저 보인다. `dialog`를 화면 어딘가에 그려야 한다 */
export function useToggleRequest(controller: WorkbenchController): {
  readonly request: (name: string, target: boolean) => void;
  readonly dialog: ReactNode;
} {
  const entries = useWorkbench((s) => s.entries);
  const [asking, setAsking] = useState<ExtListEntry | null>(null);
  return {
    request(name, target) {
      const entry = entries.find((e) => e.name === name);
      if (target && entry !== undefined && needsTrustConfirm(entry)) {
        setAsking(entry);
        return;
      }
      detachVoid(controller.toggle(name, target));
    },
    dialog: (
      <TrustDialog
        entry={asking}
        onCancel={() => {
          setAsking(null);
        }}
        onConfirm={(name) => {
          setAsking(null);
          detachVoid(controller.toggle(name, true));
        }}
      />
    ),
  };
}

export function CountsLine(): ReactNode {
  const counts = useWorkbench(countsOf);
  return (
    <p className="text-ui-sm text-text-tertiary">
      {t("desktop.workbench.counts", {
        total: counts.total,
        on: counts.on,
        auto: counts.autoDisabled,
      })}
    </p>
  );
}

export function SearchField(): ReactNode {
  const query = useWorkbench((s) => s.query);
  const actions = useWorkbenchActions();
  return (
    <Input
      size="sm"
      variant="soft"
      type="search"
      value={query}
      placeholder={t("desktop.workbench.search")}
      aria-label={t("desktop.workbench.search")}
      onValueChange={(value) => {
        actions.setQuery(value);
      }}
      containerClassName="w-60"
    />
  );
}

/** 목록이 아직 없거나 못 읽었을 때의 띠. 읽혔으면 null */
export function ListStatusBand(props: { readonly controller: WorkbenchController }): ReactNode {
  const list = useWorkbench((s) => s.list);
  const phase = useLinkPhase();
  if (phase !== "live" && list !== "ready") {
    return <Alert tone="warning">{t("desktop.workbench.offline")}</Alert>;
  }
  if (list === "loading" || list === "idle") {
    return (
      <div role="status" aria-label={t("desktop.workbench.loading")} className="grid gap-3 p-4">
        <Skeleton className="h-5" style={{ width: "80%" }} />
        <Skeleton className="h-5" style={{ width: "64%" }} />
        <Skeleton className="h-5" style={{ width: "72%" }} />
      </div>
    );
  }
  if (list === "error") {
    return (
      <Alert
        tone="danger"
        actions={[
          {
            label: t("desktop.workbench.error.retry"),
            primary: true,
            onClick: () => {
              detachVoid(props.controller.reload());
            },
          },
        ]}
      >
        {t("desktop.workbench.error.heading")}
      </Alert>
    );
  }
  return null;
}

/**
 * "끌까요?" 질문과 두 답(끄기, 켜 두기). 호스트가 묻지 않은 확장이면 아무것도 그리지 않는다.
 * 질문하는 동안 확장은 켜 둔 채다. 경고이므로 아이콘 뒤에 숨기지 않고 글로 그대로 보인다(DP-58).
 * 연결이 끊겼거나 확장이 잠겼으면 두 답을 누를 수 없다(`keepOffOf`). `compact`면 오른쪽 탭처럼 좁은 자리용이다.
 */
function KeepOffAlert(props: {
  readonly entry: ExtListEntry;
  readonly compact?: boolean | undefined;
  readonly onKeepOn: () => void;
  readonly onKeepOff: () => void;
}): ReactNode {
  const online = useLinkPhase() === "live";
  const question = keepOffOf(props.entry, online);
  if (question === null) return null;
  return (
    <Alert tone="danger" size={props.compact === true ? "sm" : undefined}>
      <p>
        {question.rule === "consecutive"
          ? t("desktop.workbench.keepOff.consecutive", {
              name: props.entry.displayName,
              count: question.consecutive,
            })
          : t("desktop.workbench.keepOff.rate", {
              name: props.entry.displayName,
              count: question.windowFailures,
            })}
      </p>
      <p className="text-ui-strong">{t("desktop.workbench.keepOff.question")}</p>
      <div className="mt-1 flex flex-wrap gap-1">
        <Button
          size="xs"
          variant="outline"
          disabled={!question.answerable}
          onClick={props.onKeepOn}
        >
          {t("desktop.workbench.keepOff.keepOn")}
        </Button>
        <Button
          size="xs"
          variant="outline"
          disabled={!question.answerable}
          onClick={props.onKeepOff}
        >
          {t("desktop.workbench.keepOff.keepOff")}
        </Button>
      </div>
    </Alert>
  );
}

/** 답한 결과. 답하면 질문 대신 이 결과 한 줄을 보인다 */
type KeepOffAnswer = "kept-on" | "kept-off";

/** 알림이 지금까지 본 것: 질문이 떠 있나, 자동으로 꺼졌나, 그리고 방금 낸 답 */
export interface NoticeMemo {
  readonly asking: boolean;
  readonly off: boolean;
  readonly answer: KeepOffAnswer | null;
}

/**
 * 새로 읽은 값으로 기억을 고친다. 질문이 떠 있다가 사라지면 답한 것이다: 자동 꺼짐이 남았으면 "껐어요", 아니면 "켜 두었어요".
 * 그 밖의 바뀜(다시 질문이 뜸, 다시 켜짐, 꺼짐)은 답 줄을 거둔다. 바뀐 것이 없으면 같은 기억을 돌려준다.
 */
export function noticeAfter(memo: NoticeMemo, asking: boolean, off: boolean): NoticeMemo {
  if (memo.asking === asking && memo.off === off) return memo;
  const answered = memo.asking && !asking;
  return { asking, off, answer: answered ? (off ? "kept-off" : "kept-on") : null };
}

/** 외부 훅 알림의 답: 이 자리에서 켜 두거나 끈 결과, 또는 질문이 다른 곳에서 답해져 사라진 것 */
type HookAnswer = "kept-on" | "kept-off" | "elsewhere";

/** 외부 훅 알림이 지금까지 본 것. `sent`는 이 질문에 대해 이 자리의 답이 성공했다는 표다(질문이 새로 뜨면 지운다) */
export interface HookNoticeMemo {
  readonly asking: boolean;
  readonly off: boolean;
  readonly sent: boolean;
  readonly answer: HookAnswer | null;
}

/**
 * 외부 훅 알림의 기억을 새 값으로 고친다. `noticeAfter`와 같은 자리에서 쓰되, 질문이 사라졌을 때 이 자리의 답이 성공했는지를 본다.
 * 성공했으면 끈·켜 둔 결과, 아니면 "다른 곳에서 답했어요"다. 답을 보내는 중(`busy`)에 질문이 사라지면 기다린다:
 * 저장소는 답을 보낸 뒤 목록을 다시 읽고 나서야 성공을 돌려주므로 질문이 성공 표보다 먼저 사라질 수 있다.
 * 바뀐 것이 없으면 같은 기억을 돌려준다(그리는 중에 고치지 않는다).
 */
export function hookNoticeAfter(
  memo: HookNoticeMemo,
  next: { readonly asking: boolean; readonly off: boolean; readonly busy: boolean },
): HookNoticeMemo {
  const answered = memo.asking && !next.asking;
  if (answered && next.busy) return memo;
  if (memo.asking === next.asking && memo.off === next.off) return memo;
  const base = { asking: next.asking, off: next.off, sent: false } as const;
  if (!answered) return { ...base, answer: null };
  if (!memo.sent) return { ...base, answer: "elsewhere" };
  return { ...base, answer: next.off ? "kept-off" : "kept-on" };
}

/**
 * 자동 꺼진 확장 하나의 알림(플러그인 카드와 오른쪽 "플러그인" 탭). 질문이 있으면 `KeepOffAlert`, 질문 없이 자동으로 꺼졌으면
 * "자동으로 꺼졌어요"와 다시 켜기를 보인다. 답하면 질문은 목록이 다시 읽히며 사라지고, 결과 한 줄이 이 부품에 남는다.
 * 그래서 부모는 항목마다 이 부품을 빼지 말고 두어야 한다(빼면 결과 줄도 사라진다). 알림도 답도 없으면 아무것도 그리지 않는다.
 * `onKeepOn`은 다시 켜기(`reenable`)다. "켜 두기"도 같은 호출이다.
 */
export function AutoOffNotice(props: {
  readonly entry: ExtListEntry;
  readonly compact?: boolean | undefined;
  readonly onKeepOn: () => void;
  readonly onKeepOff: () => void;
}): ReactNode {
  const { entry } = props;
  const asking = entry.keepOffQuestion !== undefined;
  const off = entry.autoDisabled;
  const [memo, setMemo] = useState<NoticeMemo>({ asking, off, answer: null });
  const next = noticeAfter(memo, asking, off);
  // 그리는 중에 기억을 고친다(React가 이 그림을 버리고 바로 다시 그린다). 효과에서 고치면 결과 줄이 한 장면 늦는다
  if (next !== memo) setMemo(next);
  if (next.answer === "kept-on") {
    return (
      <p role="status" className="m-0 text-ui-xs text-text-secondary">
        {t("desktop.workbench.keepOff.answer.on")}
      </p>
    );
  }
  if (next.answer === "kept-off") {
    return (
      <div className="grid justify-items-start gap-2">
        <p role="status" className="m-0 text-ui-xs text-text-secondary">
          {t("desktop.workbench.keepOff.answer.off")}
        </p>
        <Button size="xs" variant="outline" onClick={props.onKeepOn}>
          {t("desktop.workbench.reenable")}
        </Button>
      </div>
    );
  }
  if (asking) {
    return (
      <KeepOffAlert
        entry={entry}
        compact={props.compact}
        onKeepOn={props.onKeepOn}
        onKeepOff={props.onKeepOff}
      />
    );
  }
  if (off) {
    return (
      <Alert
        tone="danger"
        size={props.compact === true ? "sm" : undefined}
        action={
          <Button size="xs" variant="outline" onClick={props.onKeepOn}>
            {t("desktop.workbench.reenable")}
          </Button>
        }
      >
        {t("desktop.workbench.autoDisabled", { name: entry.displayName })}
      </Alert>
    );
  }
  return null;
}

/** 알림의 답을 보내는 쪽. 개요 화면이 컨트롤러로 채우고, 선택 카드(`ExtNotice`)가 이 값으로 답한다 */
export interface AutoOffActions {
  readonly keepOn: (name: string) => void;
  readonly keepOff: (name: string) => void;
}

export const AutoOffActionsContext: React.Context<AutoOffActions | null> =
  createContext<AutoOffActions | null>(null);

/**
 * 확장 하나의 알림을 개요의 선택 카드(플러그인·그룹)에 그린다. 항목은 스토어에서 이름으로 찾고, 답은 `AutoOffActionsContext`로 보낸다.
 * 항목이 없으면 아무것도 그리지 않는다. 항목이 있는데 답을 보낼 곳이 없으면 배선 오류다.
 */
export function ExtNotice(props: { readonly name: string }): ReactNode {
  const entry = useWorkbench((s) => s.entries.find((e) => e.name === props.name));
  const actions = useContext(AutoOffActionsContext);
  if (entry === undefined) return null;
  if (actions === null) throw new Bug("AutoOffActionsContext provider is missing");
  return (
    <AutoOffNotice
      key={entry.name}
      entry={entry}
      onKeepOn={() => {
        actions.keepOn(entry.name);
      }}
      onKeepOff={() => {
        actions.keepOff(entry.name);
      }}
    />
  );
}

/** 알림이 있는 확장인가: 질문이 떠 있거나 자동으로 꺼졌다 */
function hasNotice(entry: ExtListEntry): boolean {
  return entry.keepOffQuestion !== undefined || entry.autoDisabled;
}

/** 알림이 있는 확장 수(질문이 떠 있거나 자동으로 꺼진 확장). 오른쪽 "플러그인" 탭 칸의 숫자다 */
export function noticeCountOf(entries: readonly ExtListEntry[]): number {
  return entries.filter(hasNotice).length;
}

/** 알림이 있는 첫 확장(목록의 순서). 없으면 null. 확장 화면 경고 줄의 "보기"가 고른다 */
export function firstNoticeOf(entries: readonly ExtListEntry[]): ExtListEntry | null {
  return entries.find(hasNotice) ?? null;
}

/**
 * 확장 화면 위 경고 줄의 수: 알림이 있는 확장과 외부 훅 알림. 안전 모드(`safe`)면 훅은 세지 않는다(0).
 */
export function noticeTotalOf(
  entries: readonly ExtListEntry[],
  hooks: readonly HookNotice[],
  safe: boolean,
): number {
  return noticeCountOf(entries) + (safe ? 0 : hooks.length);
}
