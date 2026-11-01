// card slot(ADR-0021 §3.2, spec §6.25 슬롯 규칙)와 대화 안 런타임 행(DP-19).
// 셸이 그리는 것: 카드 테두리 하나, 머리(확장 아이콘 · 표시 이름 · 회색 mono id), 높이 320 상한과 넘칠 때 "더 보기",
//   카드 그리기 실패 때 일반 항목(kind 이름과 요약 한 줄, L4.desktop §4.13). 카드 안 트리는 선언형(card는 frame 금지).
// caustic 빈틈: 높이 상한 + 흐림 + "더 보기"를 가진 카드 틀이 없다. Card(outline, sm)에 토큰으로 더한다.
import { Badge, Button, Card } from "@caustic/react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { FileWarning, Layers, josa, T } from "../../_shell";
import { FINISHED } from "../data";

/** 320px(ADR-0021 §3.2 card 높이 상한) */
const CARD_MAX = 320;

export function PluginCard({
  icon,
  display,
  ext,
  onMore,
  children,
}: {
  icon: ReactNode;
  display: string;
  ext: string;
  /** "더 보기": 같은 확장의 well이나 page를 연다 */
  onMore: () => void;
  children: ReactNode;
}) {
  const body = useRef<HTMLDivElement>(null);
  const [clipped, setClipped] = useState(false);
  useLayoutEffect(() => {
    const el = body.current;
    if (el !== null) setClipped(el.scrollHeight > CARD_MAX + 1);
  });
  return (
    <Card variant="outline" size="sm" className="grid gap-2 p-3">
      <div className="flex items-center gap-1.5 text-ui-xs text-text-tertiary">
        <span aria-hidden className="inline-flex text-text-tertiary [&_svg]:size-icon-xs">
          {icon}
        </span>
        <span>{display}</span>
        <span className="font-mono text-mono-sm">{ext}</span>
      </div>
      <div
        ref={body}
        className="relative overflow-hidden"
        style={{ maxHeight: CARD_MAX }}
        data-clipped={clipped || undefined}
      >
        {children}
        {clipped && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-surface-base to-transparent"
          />
        )}
      </div>
      {clipped && (
        <Button
          size="xs"
          tone="neutral"
          variant="ghost"
          className="-ms-2 justify-self-start"
          onClick={onMore}
        >
          더 보기
        </Button>
      )}
    </Card>
  );
}

/** DP-19 런타임 행: 한 줄, muted 아이콘, secondary 글자, 출처는 tertiary(DP-33). */
export function RuntimeRow({ children, source }: { children: ReactNode; source: string }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-ui-dense text-text-secondary">
      <Layers emphasis="muted" aria-hidden className="size-icon-xs flex-none text-text-tertiary" />
      <span className="truncate">{children}</span>
      <span className="flex-none text-ui-xs text-text-tertiary">{source}</span>
    </div>
  );
}

/** 카드 그리기 실패(트리 스키마 위반·렌더 예외) → 일반 항목. 셸 글자 단계, 동작 하나(기록). */
export function GenericItem({
  kind,
  summary,
  diag,
  onLog,
}: {
  kind: string;
  summary: string;
  diag: string;
  onLog: () => void;
}) {
  return (
    <div className="grid gap-0.5">
      <div className="flex min-w-0 items-center gap-1.5 text-ui-dense text-text-secondary">
        <FileWarning
          emphasis="muted"
          aria-hidden
          className="size-icon-xs flex-none text-text-tertiary"
        />
        <span className="flex-none font-mono text-mono-sm text-text-tertiary">{kind}</span>
        <span className="truncate">{summary}</span>
        <Button
          size="xs"
          tone="neutral"
          variant="ghost"
          className="ms-auto -my-1 flex-none"
          onClick={onLog}
        >
          기록
        </Button>
      </div>
      <span className="ps-5 text-ui-xs text-text-tertiary">
        카드를 그리지 못해 기본 모양으로 보여요 · {diag}
      </span>
    </div>
  );
}

const confTone = { high: "success", med: "warning", low: "neutral" } as const;
const confLabel = { high: "높음", med: "보통", low: "낮음" } as const;

/** helm/finished 트리(선언형): Heading, Text, List(발견), ViewLink("탐구 화면 열기"). */
export function HelmFinishedTree({ tall, onOpenPage }: { tall: boolean; onOpenPage: () => void }) {
  const items = tall ? FINISHED : FINISHED.slice(0, 3);
  const applied = FINISHED.filter((f) => "applied" in f).length;
  return (
    <div className="grid gap-2">
      <div className="grid gap-0.5">
        <span className="text-ui-dense font-medium text-text-primary">
          {josa(T.inquiry, "을", "를")} 마쳤어요 · 캐시 무효화
        </span>
        <span className="text-ui-dense text-text-secondary">
          {T.lens} 3 · {T.finding} {tall ? FINISHED.length : 3} · 적용 {applied} · 상한 {T.turn} 4/4
        </span>
      </div>
      <ul className="m-0 grid list-none gap-1 p-0">
        {items.map((f) => (
          <li
            key={f.claim}
            className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-x-2"
          >
            <Badge size="sm" tone={confTone[f.conf]}>
              {confLabel[f.conf]}
            </Badge>
            <span className="truncate text-ui-dense text-text-primary">{f.claim}</span>
            <span className="text-ui-xs text-text-tertiary">{"applied" in f ? "적용함" : ""}</span>
          </li>
        ))}
      </ul>
      {tall && (
        <section aria-label="바꾼 파일" className="grid gap-0.5">
          <span className="text-ui-xs text-text-tertiary">바꾼 파일 3</span>
          {[
            ["src/cache/ttl.ts", "+12 −4"],
            ["src/cache/invalidate.ts", "+3 −1"],
            ["test/cache.test.ts", "+28"],
          ].map(([f, d]) => (
            <span key={f} className="flex gap-2 text-ui-dense">
              <span className="font-mono text-mono-sm text-text-primary">{f}</span>
              <span className="tabular-nums text-text-tertiary">{d}</span>
            </span>
          ))}
        </section>
      )}
      <div>
        <Button size="xs" tone="neutral" variant="outline" onClick={onOpenPage}>
          {T.inquiry} 화면 열기
        </Button>
      </div>
    </div>
  );
}
