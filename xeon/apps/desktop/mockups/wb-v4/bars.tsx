// 위의 두 막대. 범위 막대(전역 → 프로필 → 프로젝트 → 대화)와 단위 막대(전체 루프 / 플러그인 그룹 / 플러그인 + 이동 경로).
import { Button, SegmentedControl, SegmentedControlItem } from "@caustic/react";
import { Fragment } from "react";
import { T } from "../_shell/terms";
import {
  GROUPS,
  SCOPES,
  SCOPE_ORDER,
  UNIT_KINDS,
  ownerOf,
  scopeOf,
  unitPath,
  type Unit,
} from "./data";
import { useMock } from "./store";

const cn = (...p: Array<string | false | null | undefined>): string =>
  p.filter((x): x is string => typeof x === "string" && x !== "").join(" ");

/** 범위 막대: 한 줄 경로. 고른 범위까지가 지금 보는 값이고, 그 뒤는 아직 적용 안 되는 아래 범위다. 쓰기는 늘 고른 범위로 간다. */
export function ScopeBar() {
  const m = useMock();
  const at = SCOPE_ORDER.indexOf(m.scope);
  const cur = scopeOf(m.scope);
  const own = Object.keys(m.overrides[m.scope]).length;
  return (
    <div
      role="radiogroup"
      aria-label="범위"
      className="flex min-w-0 items-stretch border-y border-border-subtle"
    >
      {SCOPES.map((s, i) => {
        const on = s.id === m.scope;
        const below = i > at;
        return (
          <Fragment key={s.id}>
            {i > 0 && (
              <span
                aria-hidden
                className={cn(
                  "flex w-6 flex-none items-center justify-center text-footnote",
                  below ? "text-text-tertiary/50" : "text-text-tertiary",
                )}
              >
                →
              </span>
            )}
            <button
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => m.setScope(s.id)}
              className={cn(
                "relative grid min-w-0 flex-1 cursor-pointer content-center gap-0.5 px-4 py-2 text-start outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--cs-color-focus-ring)]",
                on ? "bg-neutral-soft" : "hover:bg-neutral-hover",
              )}
            >
              <span
                className={cn(
                  "text-footnote",
                  on ? "font-semibold text-text-primary" : "text-text-tertiary",
                )}
              >
                {s.label}
              </span>
              <span
                className={cn(
                  "truncate text-body",
                  below ? "text-text-tertiary" : "text-text-primary",
                  on && "font-semibold",
                )}
              >
                {s.value}
              </span>
              {on && (
                <span
                  aria-hidden
                  className="absolute inset-x-0 bottom-0 h-0.5 bg-[var(--cs-color-accent-graphic)]"
                />
              )}
            </button>
          </Fragment>
        );
      })}
      <div className="flex w-64 flex-none flex-col justify-center gap-0.5 border-s border-border-subtle px-4 py-2">
        <span className="text-footnote text-text-tertiary">쓰기</span>
        <span className="truncate text-body text-text-primary">
          {cur.writes} 저장 · {own > 0 ? `바꾼 것 ${own}` : "바꾼 것 없음"}
        </span>
      </div>
    </div>
  );
}

/** 단위 막대: 무엇을 보고 있나. 이 단위가 이 아래 모든 패널의 중심이다. */
export function UnitBar() {
  const m = useMock();
  const path = unitPath(m.unit);
  const kind = m.unit.kind;
  const choose = (k: string) => {
    if (k === "loop") m.setUnit({ kind: "loop" });
    else if (k === "group") {
      const owner = m.unit.kind === "plugin" ? ownerOf(m.unit.id) : undefined;
      const g = owner ?? GROUPS[0];
      if (g !== undefined) m.setUnit({ kind: "group", id: g.id } satisfies Unit);
    } else if (k === "plugin") {
      if (m.unit.kind === "group") m.setUnit({ kind: "plugin", id: m.unit.id });
      else m.setUnit({ kind: "plugin", id: "web-exa" });
    }
  };
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border-subtle px-4 py-2">
      <SegmentedControl
        aria-label="단위"
        size="sm"
        value={kind}
        onValueChange={choose}
        className="[&_[data-state=checked]]:font-semibold"
      >
        {UNIT_KINDS.map((k) => (
          <SegmentedControlItem key={k.id} value={k.id}>
            {k.label}
          </SegmentedControlItem>
        ))}
      </SegmentedControl>
      <nav aria-label="이동 경로" className="flex min-w-0 flex-1 items-center gap-1.5 text-body">
        {path.map((p, i) => (
          <Fragment key={`${p.label}-${i}`}>
            {i > 0 && (
              <span aria-hidden className="text-text-tertiary">
                ›
              </span>
            )}
            <button
              type="button"
              onClick={() => m.setUnit(p.unit)}
              aria-current={i === path.length - 1 ? "true" : undefined}
              className={cn(
                "cursor-pointer truncate rounded-md px-1 outline-none focus-visible:shadow-[0_0_0_2px_var(--cs-color-focus-ring)]",
                i === path.length - 1
                  ? "font-semibold text-text-primary"
                  : "text-text-tertiary hover:text-text-primary",
              )}
            >
              {p.label}
            </button>
          </Fragment>
        ))}
      </nav>
      <SegmentedControl
        aria-label="보기"
        size="sm"
        value={m.view}
        onValueChange={(v) => m.setView(v === "loop" ? "loop" : "table")}
        className="[&_[data-state=checked]]:font-semibold"
      >
        <SegmentedControlItem value="table">표</SegmentedControlItem>
        <SegmentedControlItem value="loop">루프</SegmentedControlItem>
      </SegmentedControl>
      <Button
        size="sm"
        variant="outline"
        onClick={() => m.setDrawer(m.drawer === "extensions" ? "none" : "extensions")}
        aria-pressed={m.drawer === "extensions"}
      >
        {T.extension}
      </Button>
      <Button size="sm" variant="outline" onClick={() => m.setInspectorOpen(!m.inspectorOpen)}>
        상세
      </Button>
      <Button size="sm" variant="solid" onClick={() => m.openBuilder(null, "drive")}>
        {T.plugin} 만들기
      </Button>
    </div>
  );
}
