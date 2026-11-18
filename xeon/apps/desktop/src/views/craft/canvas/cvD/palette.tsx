// cvD 왼쪽 팔레트: 지금 보는 프로필(바꾸기)과 설치된 플러그인 목록. 줄을 끌어 캔버스의 자리에 놓는다.
// 키보드: 줄에서 Enter로 집고, 화살표로 자리를 고르고, Enter로 놓고, Esc로 그만둔다.
import { t, type MessageId } from "@fresnel/client/i18n";
import { Select, SelectOption } from "@caustic/react";
import type {
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactElement,
  ReactNode,
} from "react";
import { Icon, KIND_COLOR, KindBadge } from "./glyphs.tsx";
import { hasPlugin, type CanvasProfile } from "./model.ts";
import { SAMPLE_PLUGINS, type Kind } from "./sample.ts";
import { KIND_WORD } from "./words.ts";

const ORDER: readonly Kind[] = ["drive", "inject", "hook", "tool"];

export interface ProfileChoice {
  readonly id: string;
  /** 표본 프로필은 message id, 실제 프로필은 저장된 제목 */
  readonly name: { readonly id: MessageId } | { readonly text: string };
}

export function choiceName(c: ProfileChoice): string {
  return "id" in c.name ? t(c.name.id) : c.name.text;
}

function Check(): ReactElement {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 12 12"
      aria-hidden="true"
      className="shrink-0 text-text-tertiary"
    >
      <path
        d="M2.5 6.2 5 8.6l4.5-5"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Palette(props: {
  readonly profile: CanvasProfile;
  readonly choices: readonly ProfileChoice[];
  readonly onProfile: (id: string) => void;
  readonly picking: string | null;
  readonly onPointerDown: (plugin: string, e: ReactPointerEvent<HTMLElement>) => void;
  readonly onKeyDown: (plugin: string, e: KeyboardEvent<HTMLElement>) => void;
  readonly picker: ReactNode;
  readonly open: boolean;
  readonly onToggle: () => void;
}): ReactElement {
  if (!props.open) return <PaletteRail {...props} />;
  return (
    <aside
      aria-label={t("desktop.craft.canvas.cvD.palette.label")}
      className="absolute top-0 bottom-0 left-0 z-20 flex w-[248px] flex-col border-r border-border-subtle bg-surface-base"
    >
      <div className="flex flex-col gap-1.5 px-3 pt-3 pb-3">
        <div className="flex items-center justify-between">
          <span className="px-1 text-[11px] font-medium text-text-tertiary">
            {t("desktop.craft.canvas.cvD.profile")}
          </span>
          <button
            type="button"
            data-slot="cvd"
            aria-label={t("desktop.craft.canvas.cvD.palette.collapse")}
            onClick={props.onToggle}
            className="inline-flex size-6 items-center justify-center rounded-[6px] text-text-tertiary outline-none hover:bg-[var(--cs-color-fill-hover)] hover:text-text-primary focus-visible:outline-2 focus-visible:outline-[var(--cs-color-focus-ring)]"
          >
            <Icon name="left" size={12} />
          </button>
        </div>
        <Select
          size="sm"
          aria-label={t("desktop.craft.canvas.cvD.profile")}
          value={props.profile.id}
          onValueChange={props.onProfile}
          className="w-full"
        >
          {props.choices.map((c) => (
            <SelectOption key={c.id} value={c.id}>
              {choiceName(c)}
            </SelectOption>
          ))}
        </Select>
      </div>
      <div className="mx-3 h-px bg-border-subtle" />
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <span className="text-[11px] font-medium text-text-tertiary">
          {t("desktop.craft.canvas.cvD.palette.plugins")}
        </span>
        <span className="font-mono text-[10px] text-text-tertiary tabular-nums">
          {SAMPLE_PLUGINS.length}
        </span>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {ORDER.map((kind) => (
          <li key={kind} className="mt-2 first:mt-1">
            <div className="flex items-center gap-1.5 px-2 pb-1">
              <span
                className="h-px w-2"
                style={{ background: KIND_COLOR[kind] }}
                aria-hidden="true"
              />
              <span className="text-[11px] text-text-tertiary">{t(KIND_WORD[kind])}</span>
            </div>
            <ul>
              {SAMPLE_PLUGINS.filter((p) => p.kind === kind).map((p) => {
                const inProfile = hasPlugin(props.profile, p.id);
                const picking = props.picking === p.id;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      data-slot="cvd"
                      data-palette={p.id}
                      aria-label={t(
                        inProfile
                          ? "desktop.craft.canvas.cvD.palette.rowIn"
                          : "desktop.craft.canvas.cvD.palette.row",
                        { name: p.id, kind: t(KIND_WORD[p.kind]) },
                      )}
                      aria-pressed={picking}
                      onPointerDown={(e) => props.onPointerDown(p.id, e)}
                      onKeyDown={(e) => props.onKeyDown(p.id, e)}
                      className="group flex h-7 w-full cursor-grab items-center gap-2 rounded-[8px] px-2 text-left outline-none select-none hover:bg-[var(--cs-color-fill-hover)] focus-visible:outline-2 focus-visible:outline-[var(--cs-color-focus-ring)] active:cursor-grabbing"
                      style={
                        picking
                          ? {
                              background: `color-mix(in oklab, ${KIND_COLOR[p.kind]} 14%, transparent)`,
                            }
                          : undefined
                      }
                    >
                      <KindBadge
                        kind={p.kind}
                        draft={p.draft === true}
                        guard={p.guard === true}
                        size={16}
                      />
                      <span
                        className={`min-w-0 flex-1 truncate font-mono text-[11.5px] ${inProfile ? "text-text-secondary" : "text-text-primary"}`}
                      >
                        {p.id}
                      </span>
                      {p.draft === true && (
                        <span className="text-[10.5px] text-[var(--cs-color-warning-text)]">
                          {t("desktop.craft.canvas.cvD.draft")}
                        </span>
                      )}
                      {inProfile && <Check />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
      <div className="border-t border-border-subtle px-3 py-2.5">{props.picker}</div>
    </aside>
  );
}

/** 접힌 팔레트: 배지만 세로로 선다. 끌기와 키보드 집기는 그대로 된다 */
function PaletteRail(props: {
  readonly profile: CanvasProfile;
  readonly picking: string | null;
  readonly onPointerDown: (plugin: string, e: ReactPointerEvent<HTMLElement>) => void;
  readonly onKeyDown: (plugin: string, e: KeyboardEvent<HTMLElement>) => void;
  readonly onToggle: () => void;
}): ReactElement {
  return (
    <aside
      aria-label={t("desktop.craft.canvas.cvD.palette.label")}
      className="absolute top-0 bottom-0 left-0 z-20 flex w-[52px] flex-col items-center gap-1 border-r border-border-subtle bg-surface-base py-3"
    >
      <button
        type="button"
        data-slot="cvd"
        aria-label={t("desktop.craft.canvas.cvD.palette.expand")}
        onClick={props.onToggle}
        className="mb-2 inline-flex size-7 items-center justify-center rounded-[8px] text-text-tertiary outline-none hover:bg-[var(--cs-color-fill-hover)] hover:text-text-primary focus-visible:outline-2 focus-visible:outline-[var(--cs-color-focus-ring)]"
      >
        <Icon name="right" size={14} />
      </button>
      {ORDER.map((kind) => (
        <ul
          key={kind}
          className="flex flex-col items-center gap-1 border-t border-border-subtle pt-1.5 first-of-type:border-t-0"
        >
          {SAMPLE_PLUGINS.filter((p) => p.kind === kind).map((p) => {
            const inProfile = hasPlugin(props.profile, p.id);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  data-slot="cvd"
                  data-palette={p.id}
                  title={p.id}
                  aria-label={t(
                    inProfile
                      ? "desktop.craft.canvas.cvD.palette.rowIn"
                      : "desktop.craft.canvas.cvD.palette.row",
                    { name: p.id, kind: t(KIND_WORD[p.kind]) },
                  )}
                  aria-pressed={props.picking === p.id}
                  onPointerDown={(e) => props.onPointerDown(p.id, e)}
                  onKeyDown={(e) => props.onKeyDown(p.id, e)}
                  className="inline-flex size-7 cursor-grab items-center justify-center rounded-[8px] outline-none hover:bg-[var(--cs-color-fill-hover)] focus-visible:outline-2 focus-visible:outline-[var(--cs-color-focus-ring)]"
                  style={{ opacity: inProfile ? 0.45 : 1 }}
                >
                  <KindBadge
                    kind={p.kind}
                    draft={p.draft === true}
                    guard={p.guard === true}
                    size={18}
                  />
                </button>
              </li>
            );
          })}
        </ul>
      ))}
    </aside>
  );
}
