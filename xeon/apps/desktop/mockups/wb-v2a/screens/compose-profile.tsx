// 구성기 "프로필": 프로필 하나를 층 바닥판에 쌓는다. 블록마다 켜기·끄기·그대로(그대로는 enable·disable 어디에도 넣지 않음).
// 바뀌는 블록만 차이 표지(+ − ~). 오른쪽은 결과(실효 스택)와 "첫 답이 정함" 소켓에 꽂힌 순서(tier 고정, 같은 tier 안만 옮김).
import { Button, SegmentedControl, SegmentedControlItem } from "@caustic/react";
import { useState } from "react";
import { Diamond, Lock, useShell } from "../../_shell";
import { PROFILE_FLOORS, type Pick } from "../data";
import { EXT_ICON } from "../parts/block";
import { FoldGlyph, HueTile, hueVar } from "../parts/kit";

const markOf = (now: string, pick: Pick, note?: string) => {
  if (note !== undefined) return "~";
  if (pick === "on" && now !== "켜짐") return "+";
  if (pick === "off" && now === "켜짐") return "−";
  return undefined;
};
const FACE: Record<string, string> = {
  "+": "bg-diff-add-bg text-diff-add-text",
  "−": "bg-diff-remove-bg text-diff-remove-text",
  "~": "bg-agent-soft text-agent-text",
};

export function ComposeProfile() {
  const shell = useShell();
  const [picks, setPicks] = useState<Record<string, Pick>>(() =>
    Object.fromEntries(PROFILE_FLOORS.flatMap((f) => f.items.map((i) => [i.id, i.pick]))),
  );
  return (
    <div className="wbv2 min-h-0 flex-1 overflow-auto">
      <div
        className={`mx-auto grid w-full max-w-[64rem] gap-5 px-3 pt-1 pb-8 ${shell.layout === "compact" ? "grid-cols-1" : "grid-cols-[minmax(0,1fr)_17rem]"}`}
      >
        <div className="grid content-start gap-2.5">
          {PROFILE_FLOORS.map((f) => (
            <section
              key={f.layer}
              className="grid gap-2 rounded-2xl p-3"
              style={{ background: hueVar(f.hue, "plate") }}
            >
              <h3 className="m-0 flex items-baseline gap-1.5 text-ui-sm text-text-secondary">
                <span className="font-mono text-mono-micro" style={{ color: hueVar(f.hue, "ink") }}>
                  {f.layer}
                </span>
                {f.title}
              </h3>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-2.5">
                {f.items.map((it) => {
                  const pick = picks[it.id] ?? "keep";
                  const mk = markOf(it.now, pick, pick === "on" ? it.note : undefined);
                  return (
                    <div
                      key={it.id}
                      className="relative grid gap-2 rounded-xl bg-surface-raised p-2.5 shadow-2"
                    >
                      {mk !== undefined && (
                        <span
                          className={`absolute -top-2 -left-2 grid size-5 place-items-center rounded-full text-ui-strong leading-none shadow-1 ${FACE[mk]}`}
                        >
                          {mk}
                        </span>
                      )}
                      <div className="flex items-center gap-2">
                        <HueTile hue={f.hue} size={26}>
                          {EXT_ICON[it.id] ?? <Lock />}
                        </HueTile>
                        <span className="grid min-w-0 leading-tight">
                          <span className="truncate text-ui-strong text-text-primary">
                            {it.label}
                          </span>
                          <span className="truncate text-micro text-text-tertiary">
                            지금 {it.now}
                            {mk === "+"
                              ? " → 켜짐"
                              : mk === "−"
                                ? " → 꺼짐"
                                : mk === "~"
                                  ? ` · ${it.note}`
                                  : ""}
                          </span>
                        </span>
                      </div>
                      {it.locked === true ? (
                        <span className="flex h-6 items-center gap-1 text-ui-xs text-text-tertiary [&_svg]:size-3">
                          <Lock /> 끌 수 없어요 · core tier
                        </span>
                      ) : (
                        <SegmentedControl
                          size="xs"
                          aria-label={`${it.label} 프로필 값`}
                          value={pick}
                          onValueChange={(v) => setPicks((p) => ({ ...p, [it.id]: v as Pick }))}
                        >
                          <SegmentedControlItem value="on">켜기</SegmentedControlItem>
                          <SegmentedControlItem value="off">끄기</SegmentedControlItem>
                          <SegmentedControlItem value="keep">그대로</SegmentedControlItem>
                        </SegmentedControl>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        <aside className="grid content-start gap-4">
          <section className="grid gap-2">
            <h3 className="m-0 text-ui-sm text-text-secondary">이 대화에 적용하면</h3>
            <div className="grid gap-1 rounded-2xl bg-surface-raised p-3 shadow-2">
              {[
                { l: "L3", hue: "l3" as const, items: ["Helm ~", "학습"], off: ["계획 먼저"] },
                { l: "plugin", hue: "pl" as const, items: [], off: ["acme 노트"] },
                {
                  l: "L2",
                  hue: "l2" as const,
                  items: ["웹", "Exa", "지식", "작업", "대화 도구 +"],
                  off: [],
                },
              ].map((r) => (
                <div key={r.l} className="flex flex-wrap items-center gap-1 py-1">
                  <span
                    className="w-12 font-mono text-mono-micro"
                    style={{ color: hueVar(r.hue, "ink") }}
                  >
                    {r.l}
                  </span>
                  {r.items.map((x) => (
                    <span
                      key={x}
                      className="rounded-md px-1.5 py-0.5 text-ui-xs text-text-primary"
                      style={{ background: hueVar(r.hue, "tint") }}
                    >
                      {x}
                    </span>
                  ))}
                  {r.off.map((x) => (
                    <span
                      key={x}
                      className="rounded-md px-1.5 py-0.5 text-ui-xs text-text-tertiary line-through"
                    >
                      {x}
                    </span>
                  ))}
                </div>
              ))}
              <div className="mt-1 grid gap-0.5 text-ui-xs text-text-secondary">
                <span>drive 그대로 helm · 설정 1 · 쓰는 지점 7 → 6</span>
                <span className="flex items-center gap-1 text-text-tertiary [&_svg]:size-3">
                  <Diamond /> 다음 단계 경계에 적용돼요
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                <Button size="xs" variant="solid" tone="accent">
                  이 대화에 적용
                </Button>
                <Button size="xs" variant="soft">
                  시험 대화로
                </Button>
                <Button size="xs" variant="ghost">
                  저장
                </Button>
              </div>
            </div>
          </section>
          <section className="grid gap-2">
            <h3 className="m-0 flex items-center gap-1.5 text-ui-sm text-text-secondary">
              <FoldGlyph fold="first" color="var(--ink-x)" /> tool.call.before에 꽂힌 순서
            </h3>
            <div className="grid gap-1.5 rounded-2xl p-3" style={{ background: "var(--plate-x)" }}>
              {[
                { tier: "guard", items: ["권한 판정", "샌드박스"], fixed: true },
                { tier: "user", items: ["Helm 쓰기 거부", "pre-commit-lint"] },
                { tier: "project", items: ["acme 노트"], off: true },
              ].map((t, i) => (
                <div
                  key={t.tier}
                  className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-start gap-2"
                >
                  <span className="pt-1 text-micro text-text-tertiary">
                    {i + 1}. {t.tier}
                  </span>
                  <span className="grid gap-1">
                    {t.items.map((x) => (
                      <span
                        key={x}
                        className={`flex h-7 items-center gap-1.5 rounded-lg px-2 text-ui-xs [&_svg]:size-3 ${t.off ? "border border-dashed border-border-default text-text-tertiary line-through" : "bg-surface-raised text-text-primary shadow-1"}`}
                      >
                        {t.fixed && <Lock />}
                        {x}
                      </span>
                    ))}
                  </span>
                </div>
              ))}
              <span className="text-micro leading-snug text-text-tertiary">
                앞에서 거부하면 뒤는 불리지 않아요. tier는 바꿀 수 없어요.
              </span>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
