// W5 대화 영역 오른쪽 "런타임" 탭(§4.9.8): 이 대화의 그룹 공통 정보의 정본 자리(DP-23).
// 구역: 주도(보유, 상한 사용량, 대기열·거부) · 켜진 그룹과 확장(펼치면 훅) · 전환 기록 · 실패 · "크래프트에서 보기".
// well 안이라 카드·테두리를 더하지 않고 간격으로만 묶는다(DP-10, DP-20). 머리에는 "런타임"만(DP-21), 대화 제목은 본문 첫 줄.
import { Button, Progress } from "@caustic/react";
import { useState } from "react";
import { ChevronRight, lease, switches, ToneIcon, CircleAlert, TriangleAlert } from "../../_shell";
import { threadExts } from "../data";
import { LayerCell } from "../parts/ext-bits";
import { useMock } from "../store";

function H({ children, end }: { children: string; end?: string }) {
  return (
    <h3 className="m-0 flex items-baseline gap-2 pb-1 text-ui-dense font-semibold text-text-primary">
      {children}
      {end !== undefined && (
        <span className="ms-auto text-ui-xs font-normal text-text-tertiary">{end}</span>
      )}
    </h3>
  );
}

function Gauge({
  label,
  used,
  max,
  text,
}: {
  label: string;
  used: number;
  max: number;
  text: string;
}) {
  return (
    <>
      <span className="text-text-tertiary">{label}</span>
      <Progress value={Math.round((used / max) * 100)} size="xs" label={`${label} ${text}`} />
      <span className="text-end tabular-nums text-text-secondary">{text}</span>
    </>
  );
}

function Lease() {
  const m = useMock();
  if (m.driveHolder === null)
    return (
      <section aria-label="주도" className="grid gap-1">
        <H>주도</H>
        <p className="m-0 text-ui-dense text-text-secondary">지금 drive를 쥔 그룹이 없어요</p>
        <p className="m-0 text-ui-xs text-text-tertiary">
          기본 에이전트가 턴을 그대로 돌려요 · 대기 0
        </p>
      </section>
    );
  return (
    <section aria-label="주도" className="grid gap-2">
      <H end="턴 7부터">주도</H>
      <div className="flex items-baseline gap-2 text-ui-dense">
        <span className="font-medium text-text-primary">{m.driveHolder}</span>
        <span className="text-text-secondary">보유 · 탐색 단계</span>
      </div>
      {/* 상한 사용량. Meter 빈틈(C-05)이라 Progress로 대신. */}
      <div className="grid grid-cols-[3rem_minmax(0,1fr)_5.5rem] items-center gap-x-2 gap-y-1.5 text-ui-xs">
        <Gauge
          label="턴"
          used={lease.turns[0]}
          max={lease.turns[1]}
          text={lease.turns.join(" / ")}
        />
        <Gauge
          label="spawn"
          used={lease.spawns[0]}
          max={lease.spawns[1]}
          text={lease.spawns.join(" / ")}
        />
        <Gauge label="토큰" used={lease.tokens[0]} max={lease.tokens[1]} text="120k / 400k" />
      </div>
      <ol aria-label="drive 대기열" className="m-0 grid list-none gap-0.5 p-0 text-ui-dense">
        {lease.queue.map((q, i) => (
          <li key={q.group} className="grid grid-cols-[3rem_minmax(0,1fr)] items-baseline gap-2">
            <span className="text-ui-xs text-text-tertiary">
              {q.state === "waiting" ? `대기 ${i + 1}` : "거부"}
            </span>
            <span className="truncate">
              <span className="text-text-primary">{q.group}</span>{" "}
              <span className="text-text-secondary">
                {q.state === "waiting"
                  ? "· 주도가 풀리면 다음 단계 경계에서"
                  : "· helm이 보유 중이라 14:02에 거부"}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ExtRow({ x }: { x: (typeof threadExts)[number] }) {
  const m = useMock();
  const [open, setOpen] = useState(false);
  return (
    <li className="grid">
      <div className="grid grid-cols-[1.25rem_3rem_minmax(0,1fr)_auto] items-center gap-1 text-ui-dense">
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${x.name} 훅 ${x.points.length}개 ${open ? "접기" : "펼치기"}`}
          onClick={() => setOpen(!open)}
          className="inline-grid size-5 place-items-center rounded-sm text-text-tertiary outline-none hover:text-text-primary focus-visible:focus-ring"
        >
          <ChevronRight
            aria-hidden
            className={`size-icon-xs transition-transform duration-quick ${open ? "rotate-90" : ""}`}
          />
        </button>
        <LayerCell>{x.layer}</LayerCell>
        <button
          type="button"
          onClick={() => m.openDetail(x.name, x.tone === "danger" ? "log" : "overview")}
          className="flex min-w-0 items-center gap-1.5 rounded-sm text-start outline-none hover:underline focus-visible:focus-ring"
        >
          <span className="truncate text-text-primary">{x.name}</span>
          <span className="truncate text-ui-xs text-text-tertiary">훅 {x.points.length}</span>
        </button>
        <span className="flex items-center gap-1 text-ui-xs text-text-secondary">
          {x.tone !== undefined && (
            <ToneIcon tone={x.tone}>
              {x.tone === "danger" ? <CircleAlert /> : <TriangleAlert />}
            </ToneIcon>
          )}
          {x.name === "helm" && m.driveHolder === null ? "켜짐" : x.state}
        </span>
      </div>
      {open && (
        <ul
          aria-label={`${x.name} 훅`}
          className="m-0 grid list-none gap-0.5 py-1 ps-[4.5rem] text-ui-xs text-text-secondary"
        >
          {x.points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function RuntimePanel() {
  const m = useMock();
  const rows =
    m.driveHolder === null
      ? [
          {
            at: "14:20",
            turn: 9,
            text: "helm이 주도를 놓았어요 (상한 턴 4/4)",
            reason: "release" as const,
          },
          ...[...switches].sort((a, b) => b.at.localeCompare(a.at)),
        ]
      : [...switches].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <div className="grid gap-5">
      <p className="-mb-2 m-0 truncate text-ui-xs text-text-tertiary">
        캐시 무효화 조사 · 턴 {m.driveHolder === null ? 9 : 7}
      </p>
      <Lease />
      <section aria-label="켜진 그룹과 확장" className="grid gap-0.5">
        <H end={`${threadExts.length}개`}>켜진 그룹과 확장</H>
        <ul className="m-0 grid list-none gap-0.5 p-0">
          {threadExts.map((x) => (
            <ExtRow key={x.name} x={x} />
          ))}
        </ul>
      </section>
      <section aria-label="전환 기록" className="grid gap-0.5">
        <H end="단계 경계마다">전환 기록</H>
        <ol className="m-0 grid list-none gap-1 p-0">
          {rows.map((s) => (
            <li
              key={`${s.at}-${s.text}`}
              className="grid grid-cols-[2.75rem_2.5rem_minmax(0,1fr)] items-baseline gap-1.5 text-ui-xs"
            >
              <span className="font-mono text-mono-sm tabular-nums text-text-tertiary">{s.at}</span>
              <span className="tabular-nums text-text-tertiary">턴 {s.turn}</span>
              <span className="text-text-secondary">{s.text}</span>
            </li>
          ))}
        </ol>
      </section>
      <section aria-label="실패" className="grid gap-1">
        <H>실패</H>
        <ul className="m-0 grid list-none gap-1 p-0 text-ui-dense">
          <li className="flex items-center gap-1.5">
            <ToneIcon tone="warning">
              <TriangleAlert />
            </ToneIcon>
            <span className="text-text-primary">acme-notes</span>
            <span className="min-w-0 truncate text-ui-xs text-text-secondary">
              tool.call.before · 연속 2
            </span>
            <Button
              size="xs"
              tone="neutral"
              variant="ghost"
              className="ms-auto"
              onClick={() => m.openDetail("acme-notes", "log")}
            >
              기록
            </Button>
          </li>
          <li className="flex items-center gap-1.5">
            <ToneIcon tone="danger">
              <CircleAlert />
            </ToneIcon>
            <span className="text-text-primary">review</span>
            <span className="min-w-0 truncate text-ui-xs text-text-secondary">
              자동 꺼짐 · 연속 5
            </span>
            <Button
              size="xs"
              tone="neutral"
              variant="ghost"
              className="ms-auto"
              onClick={() => m.openDetail("review", "log")}
            >
              기록
            </Button>
          </li>
        </ul>
      </section>
      <div>
        <Button size="xs" tone="neutral" variant="outline" onClick={() => m.go("overview")}>
          크래프트에서 보기
        </Button>
      </div>
    </div>
  );
}
