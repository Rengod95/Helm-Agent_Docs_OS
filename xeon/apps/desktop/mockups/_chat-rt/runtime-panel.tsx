// batch A 공용: 대화 영역 오른쪽 "런타임" 탭 내용(§4.9.8, DP-23). wb-opus W5 런타임 탭을 데이터 주도로 다시 짰다.
// 구역: 진행권(보유·단계·상한 사용량, 사람 확인 대기, 차례 기다림·거부 + "이 그룹 먼저") · 켜진 그룹과 확장(펼치면 지점)
//       · 전환 기록(단계 사이마다) · 실패 · "작업대에서 보기". well 안이라 카드·테두리 없이 간격으로만 묶는다(DP-10, DP-20).
import { Badge, Button, Progress } from "@caustic/react";
import { useState, type ReactNode } from "react";
import {
  L,
  L2,
  ChevronRight,
  CircleAlert,
  extName,
  T,
  ToneIcon,
  TriangleAlert,
  josa,
  useShell,
} from "../_shell";

export interface QueueRow {
  group: string;
  state: "waiting" | "rejected";
  note: string;
  /** "이 그룹 먼저"를 이미 눌렀다(다음 단계 사이에서 먼저 받음). */
  first?: boolean;
}
export interface GroupRow {
  layer: string;
  name: string;
  state: string;
  tone?: "warning" | "danger" | "info";
  points: string[];
}
export interface RuntimeData {
  /** 본문 첫 줄(대화 이름 · 턴). */
  caption: string;
  holder: string | null;
  /** 보유 그룹의 지금 단계 글(플러그인 status 기여). */
  phase?: string;
  since?: string;
  /** 사람 확인을 기다리느라 진행권을 반납한 그룹(X-17). */
  gate?: { group: string; text: string } | null;
  /** 시험 대화 표지(멈춤 등). */
  trial?: ReactNode;
  gauges?: {
    turns: [number, number];
    spawns: [number, number];
    tokens: string;
    tokenRatio: number;
  };
  queue: QueueRow[];
  groups: GroupRow[];
  switches: { at: string; turn: number; text: string }[];
  failures?: { name: string; text: string; tone: "warning" | "danger" }[];
}

function H({ children, end }: { children: ReactNode; end?: ReactNode }) {
  return (
    <h3 className="m-0 flex items-baseline gap-2 pb-1 text-ui-dense font-semibold text-text-primary">
      {children}
      {end !== undefined && (
        <span className="ms-auto text-ui-xs font-normal text-text-tertiary">{end}</span>
      )}
    </h3>
  );
}

function Gauge({ label, ratio, text }: { label: string; ratio: number; text: string }) {
  return (
    <>
      <span className="text-text-tertiary">{label}</span>
      <Progress value={Math.round(ratio * 100)} size="xs" label={`${label} ${text}`} />
      <span className="text-end tabular-nums text-text-secondary">{text}</span>
    </>
  );
}

function GroupLine({ g }: { g: GroupRow }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="grid">
      <div className="grid grid-cols-[1.25rem_3rem_minmax(0,1fr)_auto] items-center gap-1 text-ui-dense">
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${extName(g.name)} ${T.extensionPoint} ${g.points.length}개 ${open ? "접기" : "펼치기"}`}
          onClick={() => setOpen(!open)}
          className="inline-grid size-5 place-items-center rounded-sm text-text-tertiary outline-none hover:text-text-primary focus-visible:focus-ring"
        >
          <ChevronRight
            aria-hidden
            className={`size-icon-xs transition-transform duration-quick ${open ? "rotate-90" : ""}`}
          />
        </button>
        <span className="font-mono text-mono-sm text-text-tertiary">{g.layer}</span>
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-text-primary">{extName(g.name)}</span>
          <span className="truncate font-mono text-mono-sm text-text-tertiary">{g.name}</span>
          <span className="truncate text-ui-xs text-text-tertiary">
            {T.extensionPoint} {g.points.length}
          </span>
        </span>
        <span className="flex items-center gap-1 text-ui-xs text-text-secondary">
          {g.tone !== undefined && (
            <ToneIcon tone={g.tone}>
              {g.tone === "danger" ? <CircleAlert /> : <TriangleAlert />}
            </ToneIcon>
          )}
          {L(g.state)}
        </span>
      </div>
      {open && (
        <ul className="m-0 grid list-none gap-0.5 py-1 ps-[4.5rem] text-ui-xs text-text-secondary">
          {g.points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function RuntimePanel({
  data,
  onFirst,
  onWorkbench,
}: {
  data: RuntimeData;
  /** 차례 기다림 행의 "이 그룹 먼저"(계획에 없음 3: 이 대화의 activeDriveGroup). */
  onFirst?: (group: string) => void;
  /** "작업대에서 보기": 보기 기준을 이 대화로 고정하고 작업대로 간다. */
  onWorkbench?: () => void;
}) {
  const m = useShell();
  const goWorkbench =
    onWorkbench ??
    (() => {
      if (m.contextThreadId !== null) m.pinThread(m.contextThreadId);
      else m.setArea("workbench");
    });
  return (
    <div className="grid gap-5">
      <p className="-mb-2 m-0 truncate text-ui-xs text-text-tertiary">{data.caption}</p>
      <section aria-label={T.lead} className="grid gap-2">
        <H end={data.since}>{T.lead}</H>
        {data.trial}
        {data.holder !== null ? (
          <div className="flex items-baseline gap-2 text-ui-dense">
            <span className="font-medium text-text-primary">{extName(data.holder)}</span>
            <span className="text-text-secondary">
              {L2("보유", "holds")}
              {data.phase !== undefined ? ` · ${data.phase}` : ""}
            </span>
          </div>
        ) : (
          <p className="m-0 text-ui-dense text-text-secondary">
            {L2(
              `지금 ${josa(T.lead, "을", "를")} 쥔 ${T.group}이 없어요`,
              `No group holds the ${T.lead.toLowerCase()} now`,
            )}
          </p>
        )}
        {data.gate != null && (
          <div className="flex items-baseline gap-2 text-ui-dense">
            <Badge size="xs" tone="info">
              {T.humanGate}
            </Badge>
            <span className="min-w-0 text-text-secondary">
              <span className="text-text-primary">{extName(data.gate.group)}</span> ·{" "}
              {data.gate.text}
            </span>
          </div>
        )}
        {data.gauges !== undefined && data.holder !== null && (
          // 상한 사용량. Meter 빈틈(C-05)이라 Progress로 대신.
          <div className="grid grid-cols-[3rem_minmax(0,1fr)_5.5rem] items-center gap-x-2 gap-y-1.5 text-ui-xs">
            <Gauge
              label={T.turn}
              ratio={data.gauges.turns[0] / data.gauges.turns[1]}
              text={data.gauges.turns.join(" / ")}
            />
            <Gauge
              label="spawn"
              ratio={data.gauges.spawns[0] / data.gauges.spawns[1]}
              text={data.gauges.spawns.join(" / ")}
            />
            <Gauge
              label={L2("토큰", "Tokens")}
              ratio={data.gauges.tokenRatio}
              text={data.gauges.tokens}
            />
          </div>
        )}
        {data.queue.length > 0 && (
          <ol aria-label={T.leadQueue} className="m-0 grid list-none gap-0.5 p-0 text-ui-dense">
            {data.queue.map((q, i) => (
              <li
                key={q.group}
                className="grid min-h-6 grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-2"
              >
                <span className="text-ui-xs text-text-tertiary">
                  {q.state === "waiting" ? L2(`${i + 1}번째`, `#${i + 1}`) : L2("거부", "rejected")}
                </span>
                <span className="min-w-0 truncate">
                  <span className="text-text-primary">{extName(q.group)}</span>{" "}
                  <span className="text-text-secondary">· {q.note}</span>
                </span>
                {q.state === "waiting" && onFirst !== undefined && (
                  <Button
                    size="xs"
                    tone="neutral"
                    variant={q.first === true ? "ghost" : "outline"}
                    disabled={q.first === true}
                    data-tour="group-first"
                    onClick={() => onFirst(q.group)}
                  >
                    {q.first === true
                      ? L2("다음에 먼저", "First next")
                      : L2(`이 ${T.group} 먼저`, `This ${T.group.toLowerCase()} first`)}
                  </Button>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
      <section aria-label={`켜진 ${T.group}과 ${T.extension}`} className="grid gap-0.5">
        <H end={L2(`${data.groups.length}개`, `${data.groups.length}`)}>
          {L2(
            `켜진 ${T.group}과 ${T.extension}`,
            `${T.group}s and ${T.extension.toLowerCase()} on`,
          )}
        </H>
        <ul className="m-0 grid list-none gap-0.5 p-0">
          {data.groups.map((g) => (
            <GroupLine key={g.name} g={g} />
          ))}
        </ul>
      </section>
      <section aria-label="전환 기록" className="grid gap-0.5">
        <H end={L2(`${T.stepBoundary}마다`, `${T.stepBoundary}`)}>
          {L2("전환 기록", "Switch log")}
        </H>
        <ol className="m-0 grid list-none gap-1 p-0">
          {data.switches.map((s, i) => (
            <li
              key={`${s.at}-${i}`}
              className="grid grid-cols-[2.75rem_2.5rem_minmax(0,1fr)] items-baseline gap-1.5 text-ui-xs"
            >
              <span className="font-mono text-mono-sm tabular-nums text-text-tertiary">{s.at}</span>
              <span className="tabular-nums text-text-tertiary">
                {T.turn} {s.turn}
              </span>
              <span className="text-text-secondary">{s.text}</span>
            </li>
          ))}
        </ol>
      </section>
      {data.failures !== undefined && data.failures.length > 0 && (
        <section aria-label="실패" className="grid gap-1">
          <H>{L("실패")}</H>
          <ul className="m-0 grid list-none gap-1 p-0 text-ui-dense">
            {data.failures.map((f) => (
              <li key={f.name} className="flex items-center gap-1.5">
                <ToneIcon tone={f.tone}>
                  {f.tone === "danger" ? <CircleAlert /> : <TriangleAlert />}
                </ToneIcon>
                <span className="text-text-primary">{extName(f.name)}</span>
                <span className="min-w-0 truncate text-ui-xs text-text-secondary">{f.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div>
        <Button
          size="xs"
          tone="neutral"
          variant="outline"
          data-tour="to-workbench"
          onClick={goWorkbench}
        >
          {L2(`${T.workbench}에서 보기`, `View in ${T.workbench.toLowerCase()}`)}
        </Button>
      </div>
    </div>
  );
}

/** 공용 고정 그룹 행(t1 캐시 무효화 조사 기준). 페이지가 상태를 덮어쓴다. */
export const baseGroups: GroupRow[] = [
  {
    layer: "L3",
    name: "helm",
    state: "켜짐",
    points: ["drive", "turn.end", "tool.call.before", "boundary.settle.after"],
  },
  { layer: "L3", name: "learning", state: "켜짐", points: ["session.end", "turn.end"] },
  { layer: "L3", name: "review", state: "켜짐", points: ["drive", "tool.call.after"] },
  { layer: "L2", name: "web-exa", state: "켜짐", points: ["capability web.search"] },
];
