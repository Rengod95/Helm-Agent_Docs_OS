// 리뷰 화면의 작은 부품과 말(상세의 두 열과 목록이 같이 쓴다). 섹션 문법은 캔버스 상세 패널(cv4)과 같다:
// 섹션 제목은 15/600 primary(`text-title-3`)이고 아이콘을 달지 않는다. 섹션과 섹션은 간격과 가는 선으로 가른다.
import { t, type MessageId } from "@fresnel/client/i18n";
import { Badge, cn } from "@caustic/react";
import { assertNever } from "@fresnel/contracts";
import type { ReviewItem } from "@fresnel/contracts/wire";
import { useId, type ReactNode } from "react";
import { KindGlyph } from "./review-glyphs.tsx";
import type { EntryKind, PluginKind } from "./review-model.ts";

export const ENTRY_WORD: Readonly<Record<EntryKind, MessageId>> = {
  install: "desktop.craft.review.group.install",
  update: "desktop.craft.review.group.update",
  draft: "desktop.craft.review.group.draft",
  remove: "desktop.craft.review.group.remove",
};

export const ACTION_WORD: Readonly<Record<EntryKind, MessageId>> = {
  install: "desktop.craft.review.action.install",
  update: "desktop.craft.review.action.update",
  draft: "desktop.craft.review.action.draft",
  remove: "desktop.craft.review.action.remove",
};

const KIND_WORD: Readonly<Record<PluginKind, MessageId>> = {
  drive: "desktop.craft.review.kind.drive",
  hook: "desktop.craft.review.kind.hook",
  tool: "desktop.craft.review.kind.tool",
  inject: "desktop.craft.review.kind.inject",
};

/** 어디서 왔는지 한 줄. 대화에서 만든 것은 그 대화의 이름을 쓴다(거울에 있으면) */
export function originText(item: ReviewItem, threadTitle: string | null): string {
  if (item.kind === "remove") return t("desktop.craft.review.origin.request");
  if (item.originThreadId !== null) {
    return threadTitle === null
      ? t("desktop.craft.review.origin.thread")
      : t("desktop.craft.review.origin.threadNamed", { title: threadTitle });
  }
  switch (item.provenance) {
    case "user_instruction":
      return t("desktop.craft.review.origin.instruction");
    case "project":
      return t("desktop.craft.review.origin.project");
    case "migration":
      return t("desktop.craft.review.origin.migration");
    case "bundled":
      return t("desktop.craft.review.origin.bundled");
    case "unknown":
      return t("desktop.craft.review.origin.unknown");
    case "assistant":
      return t("desktop.craft.review.origin.folder");
    default:
      return assertNever(item.provenance, "review provenance");
  }
}

/** 올라온 때를 짧게(방금, n분 전, n시간 전, n일 전) */
export function agoText(iso: string, now: number): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "";
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));
  if (minutes < 1) return t("desktop.craft.review.ago.now");
  if (minutes < 60) return t("desktop.craft.review.ago.minutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("desktop.craft.review.ago.hours", { count: hours });
  return t("desktop.craft.review.ago.days", { count: Math.floor(hours / 24) });
}

/** 상태 칩(outlined). 결정 결과와 항목 종류를 같은 모양으로 쓴다 */
const CHIP_TONE: Readonly<Record<"neutral" | "warning", string>> = {
  neutral: "",
  warning: "text-warning-text shadow-[inset_0_0_0_1px_var(--cs-color-warning-border)]",
};

export function Chip(props: {
  readonly tone?: "neutral" | "warning";
  /** 칩 말의 풀이(마우스를 올리면 보인다). 낭독기는 칩 말을 읽고 같은 뜻의 문장은 권한과 위험 섹션이 읽는다 */
  readonly title?: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <Badge
      size="sm"
      variant="outline"
      className={CHIP_TONE[props.tone ?? "neutral"]}
      {...(props.title === undefined ? {} : { title: props.title })}
    >
      {props.children}
    </Badge>
  );
}

/** 종류 칩: 종류 색의 그림 + 이름. 종류를 가르는 데만 색을 쓴다 */
export function KindChip(props: { readonly kind: PluginKind }): ReactNode {
  return (
    <span
      className={`rv-kind-${props.kind} inline-flex h-5 items-center gap-1 rounded-md px-1.5 text-ui-sm text-text-secondary shadow-[inset_0_0_0_1px_var(--cs-color-border-default)]`}
    >
      <span className="rv-kind-text inline-flex">
        <KindGlyph kind={props.kind} size={11} />
      </span>
      {t(KIND_WORD[props.kind])}
    </span>
  );
}

/** 섹션. `id`는 시험과 찍기 도구가 섹션 순서를 읽는 표지다 */
export function Section(props: {
  readonly title: MessageId;
  readonly id: string;
  readonly aside?: ReactNode;
  readonly children: ReactNode;
}): ReactNode {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="rv-sec grid gap-3" data-section={props.id}>
      <h3
        id={headingId}
        className="m-0 flex items-baseline gap-2 text-title-3 font-semibold text-text-primary"
      >
        <span>{t(props.title)}</span>
        {props.aside === undefined ? null : (
          <span className="ms-auto text-ui-sm font-normal text-text-tertiary">{props.aside}</span>
        )}
      </h3>
      {props.children}
    </section>
  );
}

/** 두 칸짜리 정의 줄. 이름 칸 폭은 부르는 쪽이 정한다(가운데 열 48px, 오른쪽 열 72px) */
export function Fact(props: {
  readonly term: string;
  readonly children: ReactNode;
  readonly wide?: boolean;
}): ReactNode {
  return (
    <div
      className={cn(
        "grid items-baseline gap-3",
        props.wide === true ? "grid-cols-[72px_minmax(0,1fr)]" : "grid-cols-[48px_minmax(0,1fr)]",
      )}
    >
      <dt className="text-ui-sm text-text-tertiary">{props.term}</dt>
      <dd className="m-0 min-w-0 text-ui text-text-primary [overflow-wrap:anywhere]">
        {props.children}
      </dd>
    </div>
  );
}

export const MUTED = "m-0 text-ui text-text-secondary";
