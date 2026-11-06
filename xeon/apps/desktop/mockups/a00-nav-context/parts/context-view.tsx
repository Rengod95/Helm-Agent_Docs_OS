// 크래프트 가운데 대역(stand-in): 보기 기준 네 값(전체·대화·프로필·테스트)이 같은 화면을 어떻게 바꾸는지 보이는 확장 목록.
// P-16 개요(목록 + 캔버스)는 캔버스 v3 결정 대기라 여기서 그리지 않는다. 이 목록은 그 "목록 옆 패널"의 자리만 빌린다.
// 표는 투명한 가운데 위에 바로(DP-26), 머리 tertiary, 행 사이 선 없음, 층은 mono 열(DP-31), 확장 id는 mono(DP-39).
// 프로필 기준은 "적용했다면"이라 바뀌는 칸에만 "→" 표지를 붙이고(덮어쓴 것), 테스트 기준은 테스트가 덮어쓴 칸에 같은 표지를 붙인다.
import { Alert, Badge, Button } from "@caustic/react";
import {
  CircleAlert,
  josa,
  profiles,
  T,
  threads,
  ToneIcon,
  TriangleAlert,
  useShell,
  WB_WIDTH,
  WorkbenchHead,
  type WorkbenchContext,
} from "../../_shell";

type Tone = "danger" | "warning" | undefined;
interface Row {
  layer: string;
  id: string;
  name: string;
  state: string;
  tone?: Tone;
  /** 이 기준이 덮어쓴 값(프로필·테스트). */
  over?: string;
  note?: string;
}

const ALL: Row[] = [
  { layer: "L3", id: "helm", name: "Helm", state: "켜짐 · 대화 2" },
  { layer: "L3", id: "learning", name: "학습", state: "켜짐 · 대화 5" },
  { layer: "L3", id: "review", name: "리뷰", state: T.autoDisabled, tone: "danger" },
  { layer: "L3", id: "authoring", name: "제작", state: "꺼짐" },
  { layer: "L2", id: "web-exa", name: "웹 검색(Exa)", state: "켜짐" },
  { layer: T.plugin, id: "acme-notes", name: "Acme 노트", state: "켜짐 · 실패 2", tone: "warning" },
  { layer: "X", id: "audit-log", name: "감사 기록 훅", state: "켜짐" },
];

function rowsFor(c: WorkbenchContext): Row[] {
  if (c.kind === "all") return ALL;
  if (c.kind === "thread") {
    if (c.threadId === "t1")
      return [
        { layer: "L3", id: "helm", name: "Helm", state: `${T.lead} 보유 · ${T.inquiry}` },
        { layer: "L3", id: "learning", name: "학습", state: "켜짐" },
        { layer: "L3", id: "review", name: "리뷰", state: T.autoDisabled, tone: "danger" },
        { layer: "L2", id: "web-exa", name: "웹 검색(Exa)", state: "켜짐" },
        { layer: T.plugin, id: "acme-notes", name: "Acme 노트", state: "실패 2", tone: "warning" },
        { layer: "X", id: "audit-log", name: "감사 기록 훅", state: "켜짐" },
      ];
    return [
      { layer: "L3", id: "helm", name: "Helm", state: "켜짐 · 쉼" },
      { layer: "L3", id: "learning", name: "학습", state: "켜짐" },
      { layer: "L2", id: "web-exa", name: "웹 검색(Exa)", state: "켜짐" },
      { layer: "X", id: "audit-log", name: "감사 기록 훅", state: "켜짐" },
    ];
  }
  if (c.kind === "profile") {
    const p = profiles.find((x) => x.id === c.profileId);
    const on = new Set(p?.enable ?? []);
    return ALL.map((r) => {
      const was = r.state.startsWith("켜짐") || r.state.startsWith(T.lead);
      const will = on.has(r.id) || r.layer === "X";
      if (was === will) return r;
      return { ...r, over: will ? "켜짐" : "꺼짐" };
    }).concat(
      p?.settings.map((s) => ({
        layer: "",
        id: s.key,
        name: "설정",
        state: "기본값",
        over: String(s.value),
      })) ?? [],
    );
  }
  const t = threads.find((x) => x.id === c.threadId);
  const target = t?.trial?.target ?? "helm";
  return [
    {
      layer: "L3",
      id: target,
      name: target === "helm" ? "Helm" : "리뷰",
      state: "설치 기본값",
      over: `이 ${T.trialThread}에서만 켬 · ${
        t?.trial?.state === "paused" ? `멈춤, ${T.lead} 유지` : `${T.lead} 보유`
      }`,
    },
    {
      layer: "L3",
      id: "learning",
      name: "학습",
      state: "켜짐",
      over: `빠짐 · ${T.trialThread}`,
      note: "리뷰 대상에서 빠져요(X-14)",
    },
    { layer: "L2", id: "web-exa", name: "웹 검색(Exa)", state: "켜짐" },
  ];
}

function sub(c: WorkbenchContext): string {
  if (c.kind === "all") return `설치된 ${T.extension} 7 · 대화와 무관한 값`;
  if (c.kind === "thread") return `이 ${T.thread}에서 켜진 것 · ${T.turn} 3 기준 · 14:05`;
  if (c.kind === "profile")
    return `이 ${josa(T.profile, "을", "를")} 적용했다면의 모습 · 바뀌는 칸에만 → 표시`;
  return `${T.trialThread}의 실제 상태 · ${T.trial}가 덮어쓴 칸에 → 표시`;
}

export function ContextView({ title }: { title: string }) {
  const m = useShell();
  const c = m.context;
  const rows = rowsFor(c);
  const failed = rows.filter((r) => r.tone === "danger");
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <WorkbenchHead
        title={title}
        actions={
          c.kind === "profile" ? (
            <Button size="xs" variant="outline">
              {T.profile} 고치기
            </Button>
          ) : undefined
        }
        sub={<span className="text-ui-xs text-text-tertiary">{sub(c)}</span>}
      />
      <div className={`${WB_WIDTH} grid gap-3 pt-3 pb-6`}>
        {failed.length > 0 && c.kind !== "profile" && (
          <Alert tone="danger" size="sm">
            {`${failed.map((f) => f.name).join(", ")}: 연속 실패 5로 ${T.autoDisabled}. 다시 켜기 전까지 ${
              c.kind === "all" ? "모든 대화" : `이 ${T.thread}`
            }에서 빠져요.`}
          </Alert>
        )}
        <div role="table" aria-label={`${T.extension} 목록`} className="grid text-ui-dense">
          <div
            role="row"
            className="grid h-7 grid-cols-[3.5rem_minmax(0,1fr)_minmax(0,1fr)] items-center gap-3 text-ui-xs text-text-tertiary"
          >
            <span role="columnheader">{T.layer}</span>
            <span role="columnheader">{T.extension}</span>
            <span role="columnheader">이 {T.context}에서</span>
          </div>
          {rows.map((r) => (
            <div
              role="row"
              key={`${r.layer}-${r.id}`}
              className="grid min-h-8 grid-cols-[3.5rem_minmax(0,1fr)_minmax(0,1fr)] items-center gap-3 rounded-md"
            >
              <span role="cell" className="font-mono text-mono-sm text-text-tertiary">
                {r.layer}
              </span>
              <span role="cell" className="flex min-w-0 items-baseline gap-2">
                <span className="truncate text-text-primary">{r.name}</span>
                <span className="truncate font-mono text-mono-sm text-text-tertiary max-compact:hidden">
                  {r.id}
                </span>
              </span>
              <span role="cell" className="flex min-w-0 items-center gap-1.5 text-text-secondary">
                {r.tone !== undefined && (
                  <ToneIcon tone={r.tone}>
                    {r.tone === "danger" ? <CircleAlert /> : <TriangleAlert />}
                  </ToneIcon>
                )}
                <span className={r.over !== undefined ? "text-text-tertiary line-through" : ""}>
                  {r.state}
                </span>
                {r.over !== undefined && (
                  <>
                    <span aria-label="바뀜" className="text-text-tertiary">
                      →
                    </span>
                    <Badge size="xs" tone="neutral">
                      {r.over}
                    </Badge>
                  </>
                )}
                {r.note !== undefined && (
                  <span className="truncate text-ui-xs text-text-tertiary">{r.note}</span>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
