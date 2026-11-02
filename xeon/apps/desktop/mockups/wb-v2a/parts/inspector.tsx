// 검사기(오른쪽 well "검사" 탭): 고른 블록의 운영 정보와 운영 동작만(사용자 결정 2). 구조를 고치려면 "구성기에서 열기".
// ListDescription ghost xs(DP-12), 소켓마다 fold 모양 + p95/예산 막대, 실패, 설정 바인딩.
import { Button, ListDescription, ListDescriptionRow } from "@caustic/react";
import { RotateCcw, SquarePen } from "../../_shell";
import { BINDINGS, EXTS, FAILURES, HUE_OF, POINT_STATS, T1_LEASE } from "../data";
import { useMock } from "../store";
import { EXT_ICON, defaultMeta } from "./block";
import { FoldGlyph, HueTile } from "./kit";

const ms = (v: number) => (v >= 1000 ? `${v / 1000}s` : `${v}ms`);

export function Inspector() {
  const m = useMock();
  const e = EXTS.find((x) => x.id === m.selected);
  if (e === undefined)
    return (
      <p className="m-0 px-1 py-2 text-ui-sm text-text-tertiary">
        캔버스나 목록에서 블록을 고르면 여기에 보여요.
      </p>
    );
  const stats = POINT_STATS[e.id] ?? [];
  const fails = FAILURES[e.id] ?? [];
  const binds = BINDINGS[e.id] ?? [];
  const auto = e.health === "auto_disabled";
  return (
    <div className="wbv2 grid gap-4 pb-4">
      <div className="flex items-start gap-2.5">
        <HueTile hue={HUE_OF[e.layer]} size={32}>
          {EXT_ICON[e.id]}
        </HueTile>
        <div className="grid min-w-0 leading-tight">
          <span className="text-ui-strong text-text-primary">
            {e.label} <span className="font-mono text-mono-sm text-text-tertiary">{e.id}</span>
          </span>
          <span className="text-ui-xs text-text-tertiary">
            {e.layer} · {e.trust} {e.version} · {defaultMeta(e)}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {auto ? (
          <Button
            size="xs"
            variant="solid"
            tone="accent"
            iconStart={<RotateCcw />}
            onClick={() => m.notify("다음 단계 경계에 다시 켜져요")}
          >
            다시 켜기
          </Button>
        ) : (
          <Button size="xs" variant="soft" onClick={() => m.notify("다음 단계 경계에 꺼져요")}>
            이 대화에서 끄기
          </Button>
        )}
        <Button
          size="xs"
          variant="ghost"
          onClick={() => m.notify("덮어쓰기는 이 맥락에만 적용돼요")}
        >
          설정 덮어쓰기
        </Button>
        {e.layer === "L3" && (
          <Button
            size="xs"
            variant="ghost"
            iconStart={<SquarePen />}
            onClick={() => m.set({ screen: "compose", composeView: "parts" })}
          >
            구성기에서 열기
          </Button>
        )}
      </div>
      {m.ctx === "t1" && e.id === "helm" && (
        <ListDescription variant="ghost" size="xs">
          <ListDescriptionRow term="drive">보유 · 차수 {T1_LEASE.epoch}</ListDescriptionRow>
          <ListDescriptionRow term="턴">1 / 4</ListDescriptionRow>
          <ListDescriptionRow term="spawn">3 / 8</ListDescriptionRow>
          <ListDescriptionRow term="토큰">120k / 400k</ListDescriptionRow>
          <ListDescriptionRow term="대기">계획 먼저</ListDescriptionRow>
        </ListDescription>
      )}
      {stats.length > 0 && (
        <section className="grid gap-1.5">
          <h3 className="m-0 text-ui-xs text-text-tertiary">꽂은 소켓 {stats.length}</h3>
          {stats.map((s) => {
            const r = s.p95 === null ? 0 : Math.min(1, s.p95 / s.budgetMs);
            return (
              <div
                key={s.point}
                className="grid grid-cols-[0.75rem_minmax(0,1fr)_3.5rem_2.75rem] items-center gap-2 text-ui-xs"
              >
                <FoldGlyph fold={s.fold} color="var(--ink-x)" />
                <span className="truncate text-text-primary">{s.point}</span>
                <span className="relative h-1.5 overflow-hidden rounded-full bg-neutral-track">
                  <span
                    className={`absolute inset-y-0 left-0 rounded-full ${r >= 0.95 ? "bg-danger-solid" : r >= 0.2 ? "bg-warning-solid" : "bg-text-tertiary"}`}
                    style={{ width: `${Math.max(4, r * 100)}%` }}
                  />
                </span>
                <span className="text-right text-text-tertiary tabular-nums">
                  {s.p95 === null ? "—" : ms(s.p95)}
                  {s.failures > 0 && <span className="text-danger-text"> ·{s.failures}</span>}
                </span>
              </div>
            );
          })}
        </section>
      )}
      {e.consumes !== undefined && (
        <section className="grid gap-1">
          <h3 className="m-0 text-ui-xs text-text-tertiary">쓰는 기능 {e.consumes.length}</h3>
          <ListDescription variant="ghost" size="xs">
            {e.consumes.map((c) => (
              <ListDescriptionRow key={c.cap} term={c.cap} mono>
                {c.need === "requires" ? "꼭 필요" : "선택"} ·{" "}
                {c.cap === "loop.spawn"
                  ? "agents"
                  : c.cap === "web.search"
                    ? "web-exa"
                    : c.cap.startsWith("knowledge")
                      ? "knowledge"
                      : c.cap === "work.tasks"
                        ? "work"
                        : "없음"}
              </ListDescriptionRow>
            ))}
          </ListDescription>
        </section>
      )}
      {binds.length > 0 && (
        <section className="grid gap-1">
          <h3 className="m-0 text-ui-xs text-text-tertiary">설정</h3>
          <ListDescription variant="ghost" size="xs">
            {binds.map((b) => (
              <ListDescriptionRow key={b.key} term={b.title}>
                {b.value}{" "}
                <span className="font-mono text-mono-micro text-text-tertiary">{b.key}</span>
                <span className="text-text-tertiary"> · {b.from}</span>
              </ListDescriptionRow>
            ))}
          </ListDescription>
        </section>
      )}
      {fails.length > 0 && (
        <section className="grid gap-1">
          <h3 className="m-0 text-ui-xs text-text-tertiary">최근 실패</h3>
          {fails.map((f, i) => (
            <div key={i} className="grid grid-cols-[3.75rem_minmax(0,1fr)] gap-2 text-ui-xs">
              <span className="text-text-tertiary tabular-nums">{f.at}</span>
              <span className="text-text-secondary">
                {f.point} · {f.text}
              </span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
