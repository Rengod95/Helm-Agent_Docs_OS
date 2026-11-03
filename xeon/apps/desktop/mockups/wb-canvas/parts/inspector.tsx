// 검사기(오른쪽 well "검사" 탭): 캔버스에서 고른 블록 하나. caustic InspectorPanel(ghost: well이 이미 표면이라 테두리·그림자 없음, DP-20)
// 구역은 머리 · 훅 · 주도 · 기능 · 설정 바인딩(InspectorBindings) · 슬롯 · 최근 실패. 같은 내용의 전체 화면은 P-17.
import {
  Button,
  EmptyState,
  InspectorBindings,
  InspectorBindingsRow,
  InspectorPanel,
  InspectorSection,
  InspectorSectionHeader,
  ListDescription,
  ListDescriptionRow,
} from "@caustic/react";
import {
  CircleX,
  Layers,
  Maximize2,
  MousePointer2,
  SlidersHorizontal,
  TriangleAlert,
} from "../../_shell";
import {
  BINDINGS,
  FAILURES,
  POINT_STATS,
  SLOTS,
  VIEWS,
  ctxOf,
  nodeById,
  type CNode,
} from "../data";
import { FoldGlyph } from "./rail";
import { Mark } from "./node";

const fmt = (ms: number) => (ms >= 1000 ? `${+(ms / 1000).toFixed(1)}s` : `${ms}ms`);

function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const r = Math.min(1, value / max);
  return (
    <span className="inline-flex items-center gap-1.5 tabular-nums">
      <span
        role="meter"
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        className="relative h-1 w-14 overflow-hidden rounded-full bg-neutral-track"
      >
        <span
          className={`absolute inset-y-0 left-0 rounded-full ${r >= 1 ? "bg-danger-graphic" : r >= 0.5 ? "bg-warning-graphic" : "bg-text-tertiary"}`}
          style={{ width: `${Math.max(3, r * 100)}%` }}
        />
      </span>
    </span>
  );
}

const provider = (cap: string) => {
  const all = ["web", "knowledge", "work", "dialog", "agents"].map((id) => nodeById(id)!);
  return all.find((n) => n.provides?.includes(cap));
};

export function Inspector({
  id,
  ctx,
  offline,
  onOpenDetail,
  onAction,
}: {
  id: string | null;
  ctx: string;
  offline?: boolean;
  onOpenDetail: (id: string) => void;
  onAction: (t: string) => void;
}) {
  const n = id === null ? undefined : nodeById(id);
  if (n === undefined)
    return (
      <EmptyState
        size="sm"
        surface="none"
        icon={<MousePointer2 />}
        title="캔버스에서 블록을 고르세요"
        description="훅, 주도, 기능, 설정을 여기서 봐요"
        className="mt-10"
      />
    );
  return (
    <ExtInspector
      n={n}
      ctx={ctx}
      offline={offline === true}
      onOpenDetail={onOpenDetail}
      onAction={onAction}
    />
  );
}

function ExtInspector({
  n,
  ctx,
  offline,
  onOpenDetail,
  onAction,
}: {
  n: CNode;
  ctx: string;
  offline: boolean;
  onOpenDetail: (id: string) => void;
  onAction: (t: string) => void;
}) {
  const view = VIEWS[ctx] ?? VIEWS.all!;
  const st = view.nodes[n.id] ?? { on: true };
  const auto = n.health === "auto_disabled";
  const holder = view.lease?.holder === n.id;
  const points =
    POINT_STATS[n.id] ??
    (n.points ?? []).map((p) => ({
      point: p,
      fold: "tap" as const,
      budgetMs: 5000,
      p95: null,
      failures: 0,
    }));
  // 맥락이 덮어쓴 값이 있으면 그 값과 출처로 바꿔 보인다(프로필·테스트).
  const binds = (BINDINGS[n.id] ?? []).map((b) => {
    const o = view.overrides.find((x) => x.key === b.key);
    return o === undefined ? b : { ...b, value: o.value, context: [o.from] };
  });
  const slots = SLOTS[n.id];
  const fails = FAILURES[n.id] ?? [];
  const isExt = n.kind === "group" || n.kind === "plugin" || n.kind === "hook";
  const c = ctxOf(ctx);
  const status = auto
    ? "자동 꺼짐"
    : n.health === "disabled"
      ? "꺼짐"
      : st.on
        ? holder
          ? "켜짐 · drive 보유"
          : "켜짐"
        : "이 맥락에서 꺼짐";
  return (
    <div className="grid content-start gap-2">
      {/* 머리: 이름(라벨 + mono id, DP-39), 층·종류·등급·버전, 상태, 동작 둘 */}
      <div className="grid gap-1 px-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-ui-strong text-text-primary">{n.label}</span>
          <span className="truncate font-mono text-mono-sm text-text-tertiary">{n.id}</span>
          {auto && (
            <Mark tone="danger">
              <CircleX />
            </Mark>
          )}
          {n.health === "failing" && (
            <Mark tone="warning" count={n.failures}>
              <TriangleAlert />
            </Mark>
          )}
        </div>
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-ui-xs text-text-tertiary">
          <span className="font-mono text-mono-sm">
            {n.band === "L2" && n.trust === "project" ? "plugin" : n.band}
          </span>
          <span>{n.kind}</span>
          {n.trust !== undefined && <span>· {n.trust}</span>}
          {n.version !== undefined && <span>· {n.version}</span>}
          <span>· {status}</span>
        </div>
        {isExt && (
          <div className="flex gap-1 pt-1">
            {auto ? (
              <Button
                size="xs"
                variant="solid"
                disabled={offline}
                onClick={() => onAction("리뷰를 다시 켰어요 · 다음 단계 경계에 적용돼요")}
              >
                다시 켜기
              </Button>
            ) : (
              <Button
                size="xs"
                variant="soft"
                disabled={offline || n.exempt === true}
                onClick={() => onAction(`${n.label}을 끄면 다음 단계 경계에 적용돼요`)}
              >
                {st.on ? (c.kind === "thread" ? "이 대화에서 끄기" : "끄기") : "켜기"}
              </Button>
            )}
            <Button size="xs" variant="ghost" onClick={() => onOpenDetail(n.id)}>
              <Maximize2 />
              확장 상세
            </Button>
          </div>
        )}
      </div>
      <InspectorPanel
        variant="ghost"
        size="sm"
        aria-label={`${n.label} 검사기`}
        className="rounded-none"
      >
        {points.length > 0 && (
          <InspectorSection>
            <InspectorSectionHeader title={`훅 ${points.length}`} />
            <ul className="m-0 grid list-none gap-1 p-0">
              {points.map((p) => (
                <li
                  key={p.point}
                  className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 text-ui-xs whitespace-nowrap"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <FoldGlyph fold={p.fold} size={8} />
                    <span className="truncate text-text-primary">{p.point}</span>
                    <span className="flex-none text-text-tertiary">{p.fold}</span>
                  </span>
                  <span className="text-text-tertiary tabular-nums">
                    {p.p95 === null ? "–" : `p95 ${fmt(p.p95)}`} / {fmt(p.budgetMs)}
                  </span>
                  <span className="flex items-center gap-1">
                    {p.p95 !== null ? (
                      <Meter value={p.p95} max={p.budgetMs} label={`${p.point} 예산 대비`} />
                    ) : (
                      <span className="w-14" />
                    )}
                    {p.failures > 0 && (
                      <Mark tone={p.failures >= 5 ? "danger" : "warning"} count={p.failures}>
                        <TriangleAlert />
                      </Mark>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </InspectorSection>
        )}
        {n.usesDrive === true && (
          <InspectorSection>
            <InspectorSectionHeader title="주도" />
            <ListDescription variant="ghost" size="xs" aria-label="주도">
              <ListDescriptionRow term="역할">
                {holder
                  ? `보유 · 차수 ${view.lease?.epoch ?? "–"}`
                  : st.drive === "waiting"
                    ? "대기"
                    : auto
                      ? "후보 아님 · 자동 꺼짐"
                      : "없음"}
              </ListDescriptionRow>
              {holder && view.lease?.turns !== undefined && (
                <>
                  <ListDescriptionRow term="턴">
                    <span className="inline-flex items-center gap-2 tabular-nums">
                      {view.lease.turns[0]}/{view.lease.turns[1]}
                      <Meter value={view.lease.turns[0]} max={view.lease.turns[1]} label="턴" />
                    </span>
                  </ListDescriptionRow>
                  <ListDescriptionRow term="spawn">
                    <span className="inline-flex items-center gap-2 tabular-nums">
                      {view.lease.spawns?.[0]}/{view.lease.spawns?.[1]}
                      <Meter
                        value={view.lease.spawns?.[0] ?? 0}
                        max={view.lease.spawns?.[1] ?? 1}
                        label="spawn"
                      />
                    </span>
                  </ListDescriptionRow>
                  <ListDescriptionRow term="토큰">
                    <span className="inline-flex items-center gap-2 tabular-nums">
                      {Math.round((view.lease.tokens?.[0] ?? 0) / 1000)}k/
                      {Math.round((view.lease.tokens?.[1] ?? 0) / 1000)}k
                      <Meter
                        value={view.lease.tokens?.[0] ?? 0}
                        max={view.lease.tokens?.[1] ?? 1}
                        label="토큰"
                      />
                    </span>
                  </ListDescriptionRow>
                </>
              )}
            </ListDescription>
          </InspectorSection>
        )}
        {((n.consumes ?? []).length > 0 || (n.provides ?? []).length > 0) && (
          <InspectorSection>
            <InspectorSectionHeader title="기능" />
            <ul className="m-0 grid list-none gap-1 p-0 text-ui-xs">
              {(n.provides ?? []).map((cap) => (
                <li key={cap} className="flex items-center gap-1.5">
                  <span className="w-12 text-text-tertiary">provides</span>
                  <span className="text-text-primary">{cap}</span>
                </li>
              ))}
              {(n.consumes ?? []).map((cap) => {
                const p = provider(cap.id);
                return (
                  <li key={cap.id} className="flex min-w-0 items-center gap-1.5">
                    <span className="w-12 text-text-tertiary">
                      {cap.need === "requires" ? "requires" : "optional"}
                    </span>
                    <span className={p === undefined ? "text-text-tertiary" : "text-text-primary"}>
                      {cap.id}
                    </span>
                    <span className="ms-auto truncate text-text-tertiary">
                      {p === undefined
                        ? cap.need === "requires"
                          ? "없음 · 켜지지 못함"
                          : "없음 · 저하 동작"
                        : `← ${p.id}`}
                    </span>
                  </li>
                );
              })}
            </ul>
          </InspectorSection>
        )}
        {binds.length > 0 && (
          <InspectorSection>
            <InspectorSectionHeader title="설정 바인딩" />
            <InspectorBindings
              size="sm"
              addLabel={c.kind === "all" ? "설정 덮어쓰기" : `${c.label}에서 덮어쓰기`}
              addDisabled={offline}
              onAdd={() => onAction("덮어쓸 설정 키를 고르세요")}
            >
              {binds.map((b) => (
                <InspectorBindingsRow
                  key={b.key}
                  property={b.title}
                  icon={<SlidersHorizontal />}
                  token={
                    <span className="inline-flex min-w-0 items-baseline gap-1.5">
                      <span className="text-text-primary">{b.value}</span>
                      <span className="truncate font-mono text-mono-sm text-text-tertiary">
                        {b.key}
                      </span>
                    </span>
                  }
                  selectorLabel={`${b.title}, ${b.key} = ${b.value}`}
                  unbindLabel={`${b.title} 덮어쓰기 풀기`}
                  context={b.context}
                  disabled={offline}
                  unbindDisabled={b.context[0] === "기본값"}
                  onPick={() => onAction(`${b.key} 값 고르기`)}
                  onUnbind={() => onAction(`${b.key} 덮어쓰기를 풀었어요`)}
                />
              ))}
            </InspectorBindings>
          </InspectorSection>
        )}
        {slots !== undefined && (
          <InspectorSection>
            <InspectorSectionHeader title="group-sdk 슬롯" />
            <ListDescription variant="ghost" size="xs" aria-label="슬롯">
              {slots.map((s) => (
                <ListDescriptionRow key={s.slot} term={s.slot}>
                  {s.piece}
                </ListDescriptionRow>
              ))}
            </ListDescription>
          </InspectorSection>
        )}
        <InspectorSection>
          <InspectorSectionHeader
            title={`최근 실패${fails.length > 0 ? ` ${fails.length}` : ""}`}
          />
          {fails.length === 0 ? (
            <span className="text-ui-xs text-text-tertiary">없어요</span>
          ) : (
            <ul className="m-0 grid list-none gap-1 p-0 text-ui-xs">
              {fails.map((f) => (
                <li key={f.at} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
                  <span className="text-text-tertiary tabular-nums">{f.at}</span>
                  <span className="min-w-0">
                    <span className="text-text-primary">{f.point}</span>{" "}
                    <span className="text-text-secondary">{f.text}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </InspectorSection>
      </InspectorPanel>
      {!isExt && (
        <span className="flex items-center gap-1.5 px-1 text-ui-xs text-text-tertiary">
          <Layers />
          {n.band === "F" ? "계약은 읽기 전용이에요" : "코어 · 면제 tier라 끌 수 없어요"}
        </span>
      )}
    </div>
  );
}
