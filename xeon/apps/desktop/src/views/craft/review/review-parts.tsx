// 리뷰 화면의 작은 부품과 말(상세의 두 열과 목록이 같이 쓴다). 섹션 문법은 캔버스 상세 패널(cv4)과 같다:
// 섹션 제목은 15/600 primary(`text-title-3`)이고 아이콘을 달지 않는다. 섹션과 섹션은 간격과 가는 선으로 가른다.
import { t, type MessageId } from "@fresnel/client/i18n";
import { Badge, Button, toastVariants } from "@caustic/react";
import { assertNever } from "@fresnel/contracts";
import type { ReviewItem } from "@fresnel/contracts/wire";
import { useId, type ReactNode } from "react";
import { KindGlyph, ToneGlyph, type ToneName } from "./review-glyphs.tsx";
import type { HookPower } from "@fresnel/contracts/extensions";
import type { EntryKind, Keeper, Place, PluginKind, PurposeDraft } from "./review-model.ts";

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

const PLACE_WORD: Readonly<Record<Place["group"], MessageId>> = {
  input: "desktop.craft.review.place.input",
  request: "desktop.craft.review.place.request",
  tool: "desktop.craft.review.place.tool",
  turn: "desktop.craft.review.place.turn",
  thread: "desktop.craft.review.place.thread",
  other: "desktop.craft.review.place.other",
};

export function placeText(place: Place): string {
  const word = t(PLACE_WORD[place.group]);
  if (place.side === "before") return t("desktop.craft.review.place.before", { place: word });
  if (place.side === "after") return t("desktop.craft.review.place.after", { place: word });
  return t("desktop.craft.review.place.at", { place: word });
}

/** 누가 지키는가: 요약 띠의 칩 말과 권한과 위험의 줄 말(`keeperOf`) */
export const KEEPER_CHIP: Readonly<Record<Keeper, MessageId>> = {
  engine: "desktop.craft.review.chip.enforced",
  watch: "desktop.craft.review.chip.watch",
  model: "desktop.craft.review.chip.advisory",
};
export const KEEPER_LINE: Readonly<Record<Keeper, MessageId>> = {
  engine: "desktop.craft.review.risk.enforced",
  watch: "desktop.craft.review.risk.watch",
  model: "desktop.craft.review.risk.advisory",
};

const HOOK_PURPOSE: Readonly<Record<HookPower, MessageId>> = {
  observe: "desktop.craft.review.purpose.hook.observe",
  modify: "desktop.craft.review.purpose.hook.modify",
  decide: "desktop.craft.review.purpose.hook.decide",
  contribute: "desktop.craft.review.purpose.hook.contribute",
};

/** 목적 문장 기본값(`purposeDraftOf`)을 사람이 읽는 한 문장으로. 엔진의 상한(200자)을 넘지 않는다 */
export function purposeText(draft: PurposeDraft): string {
  return purposeSentence(draft).slice(0, 200);
}

function purposeSentence(draft: PurposeDraft): string {
  switch (draft.kind) {
    case "none":
      return "";
    case "toolText":
      return draft.text;
    case "drive":
      if (draft.command !== null) {
        return t("desktop.craft.review.purpose.driveCommand", { command: draft.command });
      }
      return draft.start
        ? t("desktop.craft.review.purpose.driveStart")
        : t("desktop.craft.review.purpose.drive");
    case "hook":
      return t(HOOK_PURPOSE[draft.power], { place: placeText(draft.place) });
    case "tools":
      return draft.names.length === 1
        ? t("desktop.craft.review.purpose.toolOne", { name: draft.names[0] ?? "" })
        : t("desktop.craft.review.purpose.toolMany", {
            count: draft.names.length,
            names: draft.names.join(", "),
          });
    case "server":
      return t("desktop.craft.review.purpose.server", { name: draft.name });
    case "skill":
      return t("desktop.craft.review.purpose.skill", { name: draft.name });
    case "instructions":
      return t("desktop.craft.review.purpose.instructions");
    default:
      return assertNever(draft, "review purpose draft");
  }
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

/** 섹션. `id`는 시험과 찍기 도구가 섹션 순서를 읽는 표지다. 제목과 내용 사이는 가깝게, 섹션과 섹션은 멀게(`review.css`의 `.rv-sec`) */
export function Section(props: {
  readonly title: MessageId;
  readonly id: string;
  readonly aside?: ReactNode;
  readonly children: ReactNode;
}): ReactNode {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="rv-sec" data-section={props.id}>
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

/** 이름표-값 줄들의 묶음. 한 격자라 이름표 칸의 폭과 줄 간격이 묶음 안에서 같다(`review.css`의 `.rv-facts`) */
export function Facts(props: { readonly children: ReactNode }): ReactNode {
  return <dl className="rv-facts m-0">{props.children}</dl>;
}

/** 이름표-값 한 줄. `Facts` 안에서만 쓴다 */
export function Fact(props: { readonly term: string; readonly children: ReactNode }): ReactNode {
  return (
    <div className="rv-fact-row">
      <dt className="text-ui-sm text-text-tertiary">{props.term}</dt>
      <dd className="m-0 min-w-0 text-ui text-text-primary [overflow-wrap:anywhere]">
        {props.children}
      </dd>
    </div>
  );
}

/**
 * 알림의 세기. 앱의 알림 토스트(caustic `Toast`)의 tone과 같은 이름이다: 정보(info), 주의(warning), 막힘(danger), 끝남(success), 소식(neutral)
 */
export type NoticeTone = ToneName;

/**
 * 알림 카드(m6R4 → m6R5). 앱의 알림 토스트와 같은 모양을 이 화면에서 그린다: 토스트의 면 클래스(`toastVariants`: 세기 색 테두리, 둥근 모서리 2xl,
 * 세기 색의 그림 변수 `--tone-glyph`)와 같은 칸(그림 칸 18px 높이 · 6px · 제목 13/500, 설명 12 보조 글색, 끝 단추 xs ghost).
 * caustic `Toast`는 그림을 바꿀 수 없어(주의·막힘에 느낌표) 이 화면만 느낌표 없는 그림(`ToneGlyph`)을 쓴다. 앱의 다른 토스트는 그대로다.
 * 떠 있는 토스트가 아니므로 그림자는 없다. 늘 보이는 안내는 `note`, 결정 결과처럼 방금 생긴 것은 `status`로 읽힌다
 */
export function NoticeCard(props: {
  readonly tone: NoticeTone;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  /** 시험과 찍기 도구의 표지 */
  readonly name: string;
  readonly live?: boolean;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
}): ReactNode {
  const { tone } = props;
  const action = props.actionLabel ?? null;
  const column = tone === "neutral" ? "col-span-full" : "col-start-2";
  return (
    <div
      role={props.live === true ? "status" : "note"}
      data-slot="review-notice"
      data-tone={tone}
      data-review-notice={props.name}
      className={toastVariants({ tone, shadow: "none", action: action !== null })}
    >
      <div className="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] items-start gap-x-1.5 break-keep wrap-anywhere">
        {tone === "neutral" ? null : (
          <span
            aria-hidden="true"
            className="grid h-4.5 flex-none place-items-center text-(--tone-glyph) [&_svg]:size-icon-md"
          >
            <ToneGlyph tone={tone} />
          </span>
        )}
        <div className={`${column} text-ui-strong text-text-primary`}>{props.title}</div>
        {props.description === undefined ? null : (
          <div
            className={`${column} text-ui-sm font-normal ${tone === "danger" ? "text-danger-text" : "text-text-secondary"}`}
          >
            {props.description}
          </div>
        )}
      </div>
      {action === null ? null : (
        <Button
          size="xs"
          variant="ghost"
          onClick={() => {
            props.onAction?.();
          }}
        >
          {action}
        </Button>
      )}
    </div>
  );
}

/**
 * 알림 한 줄: 카드 없이 토스트와 같은 문법(세기 색의 맨 그림 + 무채색 글). 권한과 위험의 줄, 없는 플러그인, 프로필 검사 사유가 쓴다.
 * 소식(neutral)은 그림도 흐린 색이다
 */
export function NoticeLine(props: {
  readonly tone: NoticeTone;
  readonly children: ReactNode;
  readonly slot?: string;
  readonly as?: "li" | "p";
}): ReactNode {
  const Tag = props.as ?? "p";
  return (
    <Tag
      className="rv-line-notice m-0"
      data-tone={props.tone}
      {...(props.slot === undefined ? {} : { "data-slot": props.slot })}
      {...(Tag === "p" ? { role: "note" } : {})}
    >
      <span aria-hidden="true" className="rv-line-notice-mark">
        <ToneGlyph tone={props.tone} />
      </span>
      <span className="min-w-0">{props.children}</span>
    </Tag>
  );
}

export const MUTED = "m-0 text-ui text-text-secondary";
