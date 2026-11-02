// W4 플러그인 화면: Helm 탐구(helm/inquiry, ADR-0021 §3.9). 셸 머리는 ViewHost가, 그 아래 트리는 helm의 선언형 화면이다.
// 렌더러는 그리지 않는다(§14.8). 대신 블록마다 "widget:" 주석으로 렌더러가 낼 위젯을 적고, 위젯 카탈로그 v1 부품만 쓴다.
// 플러그인은 색·간격·글꼴을 정하지 않으므로 여기 간격은 렌더러(Stack/Section)의 기본값을 흉내 낸 것이다.
import { Badge, Button, Progress, Stepper, toast } from "@caustic/react";
import { helmInquiry, lease, type Finding } from "../../_shell";
import { SectionTitle } from "../parts/ext-bits";
import { LensTree } from "../parts/lens-tree";
import { UnknownWidget, ViewHost } from "../parts/view-host";
import { useMock } from "../store";

const conf: Record<
  Finding["confidence"],
  { label: string; tone: "success" | "warning" | "neutral" }
> = {
  high: { label: "높음", tone: "success" },
  med: { label: "보통", tone: "warning" },
  low: { label: "낮음", tone: "neutral" },
};
const pastResult: Record<string, string> = { applied: "적용함", limit: "상한 도달" };

function HelmTree() {
  const m = useMock();
  const q = helmInquiry;
  return (
    // widget: Stack
    <div className="grid gap-6">
      {/* widget: Row — Text(주제), Text(신호), Button(call ext.helm.stop). "멈춤"은 플러그인 동작이라 셸 머리가 아니라 트리 첫 줄에 둔다(DP-22). */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-ui-dense">
        <span>
          <span className="text-text-tertiary">주제 </span>
          <span className="font-medium text-text-primary">{q.topic}</span>
        </span>
        <span>
          <span className="text-text-tertiary">신호 </span>
          <span className="text-text-secondary">
            {q.signal.kind} · {q.signal.text}
          </span>
        </span>
        <Button
          size="xs"
          tone="neutral"
          variant="outline"
          className="ms-auto"
          onClick={() =>
            toast({ title: "탐구를 멈췄어요", description: "다음 단계 경계에서 주도를 놓아요." })
          }
        >
          멈춤
        </Button>
      </div>

      {/* widget: Stepper(bind /phase) */}
      <Stepper
        size="xs"
        variant="ghost"
        className="max-w-[36rem]"
        value={1}
        aria-label="탐구 단계"
        statusLabels={{ done: "끝남", now: "지금", todo: "남음", failed: "실패" }}
        steps={[
          { id: "diverge", label: "확산", status: "done" },
          { id: "explore", label: "탐색", status: "now", description: "렌즈 3 · 1 실행 중" },
          { id: "converge", label: "수렴", status: "todo" },
          { id: "apply", label: "적용", status: "todo" },
        ]}
      />

      {/* widget: Split */}
      <div className="grid gap-6 medium:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* widget: Section(Heading h2) + ActivityTree(each /lenses) */}
        <section aria-label="렌즈" className="grid content-start gap-1">
          <SectionTitle end="자식 에이전트 3">렌즈</SectionTitle>
          <LensTree lenses={q.lenses} defaultOpen={["failure-cases"]} />
        </section>

        {/* widget: Section + List(each /findings): Badge, Text, Text, TurnLink */}
        <section aria-label="발견" className="grid content-start gap-1">
          <SectionTitle end={`${q.findings.length}개`}>발견</SectionTitle>
          <ul className="m-0 grid list-none gap-3 p-0">
            {q.findings.map((f) => (
              <li
                key={f.claim}
                className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-2 gap-y-0.5"
              >
                <Badge size="sm" tone={conf[f.confidence].tone}>
                  {conf[f.confidence].label}
                </Badge>
                <span className="text-ui-dense text-text-primary">{f.claim}</span>
                <span />
                <span className="flex flex-wrap items-baseline gap-x-2 text-ui-xs text-text-tertiary">
                  <span>출처 {f.sources.join(", ")}</span>
                  {f.task !== null ? (
                    <button
                      type="button"
                      onClick={() =>
                        toast({ title: "대화 작업 탭으로 가요", description: `작업 ${f.task}` })
                      }
                      className="rounded-sm text-text-secondary underline-offset-2 outline-none hover:underline focus-visible:focus-ring"
                    >
                      작업 {f.task}
                    </button>
                  ) : (
                    <span>작업 없음</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* widget: Section + Meter ×2 (caustic Meter 빈틈 C-05 → Progress). S9: 새 위젯 Sparkline은 자리표시. */}
      <section aria-label="주도와 토큰" className="grid gap-1.5">
        <SectionTitle>주도와 토큰</SectionTitle>
        <div className="grid max-w-[32rem] grid-cols-[4rem_minmax(0,1fr)_6rem] items-center gap-x-3 gap-y-1.5 text-ui-dense">
          <span className="text-text-tertiary">턴</span>
          <Progress value={25} size="xs" label="주도 턴 1/4" />
          <span className="tabular-nums text-text-secondary">{lease.turns.join(" / ")}</span>
          <span className="text-text-tertiary">spawn</span>
          <Progress value={38} size="xs" label="spawn 3/8" />
          <span className="tabular-nums text-text-secondary">{lease.spawns.join(" / ")}</span>
          <span className="text-text-tertiary">토큰</span>
          <Progress value={30} size="xs" label="토큰 120k/400k" />
          <span className="tabular-nums text-text-secondary">120k / 400k</span>
        </div>
        {m.viewError && (
          <div className="max-w-[32rem] pt-1">
            <UnknownWidget
              type="Sparkline"
              diag="widget_unknown · /views/inquiry.view.json#/children/5/children/2"
            />
          </div>
        )}
      </section>

      {/* widget: Section + Table(query ext.helm.inquiries) */}
      <section aria-label="지난 탐구" className="grid gap-1">
        <SectionTitle>지난 탐구</SectionTitle>
        <ul className="m-0 grid max-w-[32rem] list-none gap-1 p-0">
          {q.past.map((p) => (
            <li
              key={p.at}
              className="grid grid-cols-[minmax(0,1fr)_5rem_6rem_3.5rem] items-baseline gap-3 text-ui-dense"
            >
              <span className="truncate text-text-primary">{p.topic}</span>
              <span className="text-text-secondary">{pastResult[p.result]}</span>
              <span className="tabular-nums text-text-tertiary">{p.at}</span>
              <span className="text-end tabular-nums text-text-tertiary">발견 {p.findings}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function PluginView() {
  const m = useMock();
  const helm = m.ext("helm");
  const on = helm?.status === "enabled";
  return (
    <ViewHost
      title="Helm 탐구"
      ext="helm"
      trust="user"
      version="0.1.0"
      state={on ? "active" : "extension_disabled"}
      disabledReason="사용자가 껐어요 · 14:20"
      onBackToChat={() => m.backToChat(on ? "helm/panel" : "runtime")}
      onOpenDetail={() => m.openDetail("helm")}
    >
      <HelmTree />
    </ViewHost>
  );
}
