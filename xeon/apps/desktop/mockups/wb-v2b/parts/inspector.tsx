// 오른쪽 well "검사" 탭(결정 1: well은 검사기). 고른 블록의 포트를 역할별로 묶고, 운영 동작만 둔다(결정 2).
import { Button, ListDescription, ListDescriptionRow } from "@caustic/react";
import { ArrowUpRight, RotateCcw } from "../../_shell";
import { EXTS, HEAT, SOCKETS, extById, lease, providerOf } from "../data";
import { ExtIcon, Face, FoldGlyph, PortGlyph } from "./kit";

function Sec({
  title,
  count,
  children,
}: {
  title: string;
  count?: number | string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="flex h-6 items-center gap-1.5 text-ui-xs text-text-tertiary">
        {title}
        {count !== undefined && <span className="font-mono tabular-nums">{count}</span>}
      </h3>
      {children}
    </section>
  );
}

const fmt = (ms: number | null) =>
  ms === null ? "—" : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;

export function Inspector({
  id,
  onAction,
  failure,
}: {
  id: string | null;
  onAction: (s: string) => void;
  failure: boolean;
}) {
  if (id === null)
    return (
      <p className="px-1 py-2 text-ui-sm text-text-tertiary">
        캔버스나 목록에서 블록을 고르면 여기에 연결과 상태가 보여요.
      </p>
    );
  const e = extById(id);
  const heat = HEAT[e.id] ?? {};
  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-start gap-2.5">
        <Face health={e.health} size={28}>
          <ExtIcon name={e.icon} />
        </Face>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-baseline gap-1.5">
            <span className="text-title-4 text-text-primary">{e.label}</span>
            <span className="truncate font-mono text-mono-sm text-text-tertiary">{e.id}</span>
          </span>
          <span className="text-ui-xs text-text-tertiary">
            {e.layer} · {e.kind} · {e.trust} · {e.version}
          </span>
        </div>
      </header>
      {failure && e.id === "review" ? (
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="xs"
            tone="neutral"
            variant="solid"
            iconStart={<RotateCcw />}
            onClick={() => onAction("다음 단계 경계에 다시 켜져요")}
          >
            다시 켜기
          </Button>
          <Button
            size="xs"
            tone="neutral"
            variant="ghost"
            iconEnd={<ArrowUpRight />}
            onClick={() => onAction("구성기에서 열어요")}
          >
            구성기에서 열기
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="xs"
            tone="neutral"
            variant="soft"
            onClick={() => onAction("다음 단계 경계에 꺼져요")}
          >
            이 대화에서 끄기
          </Button>
          <Button
            size="xs"
            tone="neutral"
            variant="soft"
            onClick={() => onAction("설정 덮어쓰기 칸을 열어요")}
          >
            설정 덮어쓰기
          </Button>
          {e.kind === "group" && (
            <Button
              size="xs"
              tone="neutral"
              variant="ghost"
              iconEnd={<ArrowUpRight />}
              onClick={() => onAction("구성기에서 열어요")}
            >
              구성기에서 열기
            </Button>
          )}
        </div>
      )}

      {e.consumes && (
        <Sec title="입력 · 능력" count={e.consumes.length}>
          <ul className="flex flex-col">
            {e.consumes.map((c) => {
              const p = providerOf(c.id);
              return (
                <li key={c.id} className="flex h-6 items-center gap-2 text-ui-xs">
                  <PortGlyph type="cap" hollow={c.need === "optional"} />
                  <span className="min-w-0 flex-1 truncate text-text-primary">{c.id}</span>
                  <span className={p === undefined ? "text-warning-text" : "text-text-tertiary"}>
                    {p === undefined
                      ? c.need === "requires"
                        ? "없음 · 켜지지 못함"
                        : "없음 · 저하 동작"
                      : `← ${p.label}`}
                  </span>
                </li>
              );
            })}
          </ul>
        </Sec>
      )}
      {e.provides && (
        <Sec title="출력 · 능력" count={e.provides.length}>
          <ul className="flex flex-col">
            {e.provides.map((c) => {
              const users = EXTS.filter((o) => o.consumes?.some((x) => x.id === c));
              return (
                <li key={c} className="flex h-6 items-center gap-2 text-ui-xs">
                  <PortGlyph type="cap" />
                  <span className="min-w-0 flex-1 truncate text-text-primary">{c}</span>
                  <span className="text-text-tertiary">
                    {users.length > 0
                      ? `→ ${users.map((u) => u.label).join(", ")}`
                      : "쓰는 곳 없음"}
                  </span>
                </li>
              );
            })}
          </ul>
        </Sec>
      )}
      {(e.points?.length ?? 0) > 0 && (
        <Sec title="출력 · on" count={e.points!.length}>
          <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-2 text-ui-xs">
            {e.points!.map((p) => {
              const s = SOCKETS.find((x) => x.point === p)!;
              const h = heat[p];
              const ratio = h?.p95 != null ? h.p95 / s.budgetMs : 0;
              return (
                <div key={p} className="contents">
                  <FoldGlyph fold={s.fold} />
                  <span className="flex h-6 min-w-0 items-center truncate text-text-primary">
                    {p}
                  </span>
                  <span className="relative h-1 w-12 overflow-hidden rounded-full bg-neutral-track">
                    <span
                      className="absolute inset-y-0 left-0 rounded-full"
                      style={{
                        width: `${Math.max(4, ratio * 100)}%`,
                        background:
                          ratio >= 1
                            ? "var(--cs-color-danger-solid)"
                            : ratio >= 0.5
                              ? "var(--cs-color-warning-solid)"
                              : "var(--port-on)",
                      }}
                    />
                  </span>
                  <span
                    className={`w-12 text-end font-mono tabular-nums ${(h?.fail ?? 0) > 0 ? "text-danger-text" : "text-text-tertiary"}`}
                  >
                    {fmt(h?.p95 ?? null)}
                    {(h?.fail ?? 0) > 0 ? ` ×${h!.fail}` : ""}
                  </span>
                </div>
              );
            })}
          </div>
        </Sec>
      )}
      {(e.usesPost || e.usesDrive) && (
        <Sec title="출력 · post · drive">
          <ListDescription variant="ghost" size="xs">
            {e.usesPost && (
              <ListDescriptionRow term="post">입력 큐 · 제안, 종료 알림</ListDescriptionRow>
            )}
            {e.usesDrive && (
              <ListDescriptionRow term="drive">
                {e.id === lease.holder
                  ? `보유(캐시 무효화 조사) · 턴 ${lease.turns[0]}/${lease.turns[1]} · spawn ${lease.spawns[0]}/${lease.spawns[1]}`
                  : e.health === "danger"
                    ? "후보 아님(자동 꺼짐)"
                    : "후보 · 대기 1번째"}
              </ListDescriptionRow>
            )}
          </ListDescription>
        </Sec>
      )}
      {e.id === "helm" && (
        <Sec title="설정">
          <ListDescription variant="ghost" size="xs">
            <ListDescriptionRow term="렌즈 수">
              3{" "}
              <span className="font-mono text-mono-sm text-text-tertiary">ext.helm.maxLenses</span>
            </ListDescriptionRow>
            <ListDescriptionRow term="자동 시작">
              suggest{" "}
              <span className="font-mono text-mono-sm text-text-tertiary">ext.helm.autoStart</span>
            </ListDescriptionRow>
          </ListDescription>
        </Sec>
      )}
      {e.id === "review" && (
        <Sec title="최근 실패" count={5}>
          <ul className="flex flex-col text-ui-xs">
            {["13:40", "13:31", "13:22", "13:09", "12:58"].map((t, i) => (
              <li key={t} className="flex h-6 items-center gap-2">
                <span className="font-mono text-text-tertiary tabular-nums">{t}</span>
                <span className="min-w-0 flex-1 truncate text-text-primary">
                  boundary.settle.after
                </span>
                <span className="text-text-tertiary">
                  {i === 0 ? "예산 초과 5.0s" : "예산 초과"}
                </span>
              </li>
            ))}
          </ul>
          <Button
            size="xs"
            variant="ghost"
            tone="neutral"
            iconStart={<RotateCcw />}
            onClick={() => onAction("시험 실행에서 replay를 열어요")}
          >
            replay로 되짚기
          </Button>
        </Sec>
      )}
    </div>
  );
}
