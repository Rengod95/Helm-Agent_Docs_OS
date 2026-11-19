// cvA 왼쪽 플러그인 목록: 설치된 플러그인 전부를 종류별로. 끌어서 레일에 놓거나, Enter로 들고 화살표로 자리를 고른다.
// 프로필에 이미 있는 것은 오른쪽에 작은 마름모가 선다(다시 끌면 순서가 바뀐다). 캔버스의 노드를 여기로 끌어 오면 빠진다.
import { t } from "@fresnel/client/i18n";
import type { PointerEvent, ReactNode, Ref } from "react";
import { KIND_INK, KindGlyph } from "./glyphs.tsx";
import { KINDS, inProfile, isBase, type PluginSpec, type ProfileModel } from "./model.ts";
import { KIND_KEY } from "./words.ts";

export interface PaletteProps {
  readonly specs: readonly PluginSpec[];
  readonly profile: ProfileModel;
  readonly collapsed: boolean;
  /** 지금 들고 있는 이름(키보드 들기나 끌기) */
  readonly carrying: string | null;
  /** 캔버스 노드를 끌어 여기 올렸다(놓으면 빠진다) */
  readonly removeHot: boolean;
  readonly ref: Ref<HTMLDivElement>;
  readonly onToggle: () => void;
  readonly onPointerDown: (name: string, e: PointerEvent<HTMLElement>) => void;
  readonly onLift: (name: string) => void;
}

function stateOf(spec: PluginSpec, profile: ProfileModel): string | null {
  if (spec.draft === true) return t("desktop.craft.canvas.cvA.mark.draft");
  if (isBase(profile, spec.name)) return t("desktop.craft.canvas.cvA.mark.base");
  return null;
}

export function Palette(props: PaletteProps): ReactNode {
  const { specs, profile, ref, onToggle } = props;
  return (
    <div
      ref={ref}
      data-remove-hot={props.removeHot}
      className={`cva-panel absolute top-14 bottom-3 left-3 z-10 flex flex-col ${props.collapsed ? "w-11" : "w-[196px]"}`}
      style={props.removeHot ? { borderColor: "var(--cs-color-danger-border)" } : undefined}
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--cva-line-soft)] ps-3 pe-1">
        {props.collapsed ? null : (
          <span className="flex-1 text-[12px] font-medium text-text-secondary">
            {t("desktop.craft.canvas.cvA.palette.title")}
          </span>
        )}
        <button
          type="button"
          className="cva-row flex size-7 items-center justify-center text-text-tertiary"
          aria-label={t(
            props.collapsed
              ? "desktop.craft.canvas.cvA.palette.expand"
              : "desktop.craft.canvas.cvA.palette.collapse",
          )}
          aria-expanded={!props.collapsed}
          onClick={onToggle}
        >
          <svg aria-hidden width="14" height="14" viewBox="0 0 14 14">
            <path
              d={props.collapsed ? "M5 3l4 4-4 4" : "M9 3 5 7l4 4"}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
            />
          </svg>
        </button>
      </div>
      {props.removeHot ? (
        <div className="px-3 py-2 text-[12px] text-danger-text">
          {t("desktop.craft.canvas.cvA.palette.dropToRemove")}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
        {KINDS.map((kind) => {
          const rows = specs.filter((s) => s.kind === kind);
          if (rows.length === 0) return null;
          return (
            <section key={kind} aria-label={t(KIND_KEY[kind])} className="pb-1.5">
              <div
                className="flex h-7 items-center gap-2 ps-3"
                style={{ color: KIND_INK[kind] }}
                title={props.collapsed ? t(KIND_KEY[kind]) : undefined}
              >
                <KindGlyph kind={kind} size={13} />
                {props.collapsed ? null : (
                  <span className="cva-mono text-[11px] text-text-tertiary">
                    {t(KIND_KEY[kind])}
                  </span>
                )}
              </div>
              {props.collapsed
                ? null
                : rows.map((spec) => {
                    const placed = inProfile(profile, spec.name);
                    const state = stateOf(spec, profile);
                    const lifted = props.carrying === spec.name;
                    return (
                      <button
                        key={spec.name}
                        type="button"
                        data-palette-row={spec.name}
                        data-kind={spec.kind}
                        aria-label={t("desktop.craft.canvas.cvA.palette.row", {
                          name: spec.name,
                          kind: t(KIND_KEY[spec.kind]),
                          placed: placed ? "yes" : "no",
                        })}
                        aria-pressed={lifted}
                        className="cva-row flex h-8 w-full cursor-grab items-center gap-2 ps-[29px] pe-3 text-start active:cursor-grabbing"
                        style={
                          lifted
                            ? { background: "color-mix(in oklab, var(--cva-ink) 14%, transparent)" }
                            : undefined
                        }
                        onPointerDown={(e) => {
                          props.onPointerDown(spec.name, e);
                        }}
                        onKeyDown={(e) => {
                          if (e.key !== "Enter" && e.key !== " ") return;
                          e.preventDefault();
                          props.onLift(spec.name);
                        }}
                      >
                        <span
                          className={`min-w-0 flex-1 truncate text-[13px] ${placed ? "text-text-secondary" : "text-text-primary"}`}
                        >
                          {spec.name}
                        </span>
                        {state === null ? null : (
                          <span className="cva-mono text-[11px] text-text-tertiary">{state}</span>
                        )}
                        {placed ? (
                          <svg
                            aria-hidden
                            width="8"
                            height="8"
                            viewBox="0 0 8 8"
                            className="shrink-0"
                          >
                            <path d="M4 .8 7.2 4 4 7.2.8 4z" fill="var(--cva-line-hot)" />
                          </svg>
                        ) : (
                          <span aria-hidden className="w-2 shrink-0" />
                        )}
                      </button>
                    );
                  })}
            </section>
          );
        })}
      </div>
    </div>
  );
}
