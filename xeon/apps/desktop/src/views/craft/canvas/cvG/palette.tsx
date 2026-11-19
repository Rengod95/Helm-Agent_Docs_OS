// cvG 사이드 패널(D의 판을 바탕으로): 보고 있는 프로필 고르기와 설치된 플러그인 목록(종류마다 색·아이콘), 묶음 목록.
// 줄을 누르면(Enter·Space도) 캔버스가 그 노드로 움직여 포커스가 간다. 프로필에 없는 줄은 상세가 뜨고 "넣기"가 있다.
// 줄을 캔버스로 끌어 놓으면 넣는다(붙는 자리는 플러그인이 정한다). 위·아래 화살표로 줄 사이를 옮긴다.
import { t, type MessageId } from "@fresnel/client/i18n";
import { Select, SelectOption } from "@caustic/react";
import type { KeyboardEvent, PointerEvent as ReactPointerEvent, ReactElement } from "react";
import type { SharedProfileId } from "../shared-sample.ts";
import { Icon, KIND_COLOR, KindTile, PartGlyph } from "./glyphs.tsx";
import { inProfile, INSTALLED, type CanvasProfile, type Kind } from "./model.ts";
import { bundleMetaOf } from "./sample-ext.ts";
import { KIND_WORD } from "./words.ts";

const ORDER: readonly Kind[] = ["drive", "inject", "hook", "tool"];
const PALETTE_W = 248;
const RAIL_W = 52;

const CHOICES: readonly { readonly id: SharedProfileId; readonly name: MessageId }[] = [
  { id: "dev", name: "desktop.craft.canvas.cvG.profile.dev" },
  { id: "empty", name: "desktop.craft.canvas.cvG.profile.empty" },
  { id: "scale", name: "desktop.craft.canvas.sample.scale" },
];

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

export interface PaletteProps {
  readonly profile: CanvasProfile;
  readonly current: SharedProfileId;
  readonly bundles: readonly { readonly id: string; readonly members: readonly string[] }[];
  readonly focused: string | null;
  readonly open: boolean;
  readonly onProfile: (id: SharedProfileId) => void;
  readonly onPick: (id: string) => void;
  readonly onAdd: (name: string) => void;
  readonly onPointerDown: (name: string, e: ReactPointerEvent<HTMLElement>) => void;
  readonly onToggle: () => void;
}

/** 위·아래 화살표: 같은 판 안의 다음 줄로 */
function rowKey(e: KeyboardEvent<HTMLElement>, id: string, props: PaletteProps): void {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    props.onPick(id);
    return;
  }
  if (e.key === "+" && !id.startsWith("bundle:")) {
    e.preventDefault();
    props.onAdd(id);
    return;
  }
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  e.preventDefault();
  const rows = [
    ...(e.currentTarget.closest("aside")?.querySelectorAll<HTMLElement>("[data-row]") ?? []),
  ];
  const i = rows.indexOf(e.currentTarget);
  rows[i + (e.key === "ArrowDown" ? 1 : -1)]?.focus();
}

export function Palette(props: PaletteProps): ReactElement {
  if (!props.open) return <PaletteRail {...props} />;
  const count = INSTALLED.filter((p) => inProfile(props.profile, p.name)).length;
  return (
    <aside
      aria-label={t("desktop.craft.canvas.cvG.palette.label")}
      className="cvg-palette flex shrink-0 flex-col"
      style={{ width: PALETTE_W }}
    >
      <div className="flex flex-col gap-1.5 px-3 pt-3 pb-3">
        <div className="flex items-center justify-between">
          <span className="px-1 text-[11px] font-medium text-text-tertiary">
            {t("desktop.craft.canvas.cvG.profile")}
          </span>
          <button
            type="button"
            aria-label={t("desktop.craft.canvas.cvG.palette.collapse")}
            onClick={props.onToggle}
            className="cvg-icon-btn"
          >
            <Icon name="left" size={12} />
          </button>
        </div>
        <Select
          size="sm"
          aria-label={t("desktop.craft.canvas.cvG.profile")}
          value={props.current}
          onValueChange={(v) => {
            const hit = CHOICES.find((c) => c.id === v);
            if (hit !== undefined) props.onProfile(hit.id);
          }}
          className="w-full"
        >
          {CHOICES.map((c) => (
            <SelectOption key={c.id} value={c.id}>
              {t(c.name)}
            </SelectOption>
          ))}
        </Select>
      </div>
      <div className="mx-3 h-px bg-border-subtle" />
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <span className="text-[11px] font-medium text-text-tertiary">
          {t("desktop.craft.canvas.cvG.palette.plugins")}
        </span>
        <span className="text-[10.5px] text-text-tertiary tabular-nums">
          {t("desktop.craft.canvas.cvG.palette.inCount", { n: count, of: INSTALLED.length })}
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
              {INSTALLED.filter((p) => p.kind === kind).map((p) => {
                const inside = inProfile(props.profile, p.name);
                const draft = p.meta.review.state === "draft";
                return (
                  <li key={p.name} className="group relative">
                    <button
                      type="button"
                      data-row=""
                      data-palette={p.name}
                      aria-current={props.focused === p.name ? "true" : undefined}
                      aria-label={t(
                        inside
                          ? "desktop.craft.canvas.cvG.palette.rowIn"
                          : "desktop.craft.canvas.cvG.palette.row",
                        {
                          name: p.name,
                          kind: t(KIND_WORD[p.kind]),
                        },
                      )}
                      onPointerDown={(e) => props.onPointerDown(p.name, e)}
                      onClick={() => props.onPick(p.name)}
                      onKeyDown={(e) => rowKey(e, p.name, props)}
                      className="cvg-row"
                    >
                      <KindTile kind={p.kind} size={18} draft={draft} />
                      <span
                        className={`min-w-0 flex-1 truncate text-[12.5px] ${inside ? "text-text-primary" : "text-text-secondary"}`}
                      >
                        {p.name}
                      </span>
                      {draft ? (
                        <span className="text-[10.5px] text-[var(--cs-color-warning-text)]">
                          {t("desktop.craft.canvas.cvG.review.draft")}
                        </span>
                      ) : p.meta.pending !== null ? (
                        <span className="text-[10.5px] text-text-tertiary">
                          {t("desktop.craft.canvas.cvG.review.pendingShort")}
                        </span>
                      ) : null}
                      {inside ? <Check /> : null}
                    </button>
                    {inside ? null : (
                      <button
                        type="button"
                        tabIndex={-1}
                        aria-label={t("desktop.craft.canvas.cvG.act.addNamed", { name: p.name })}
                        title={t("desktop.craft.canvas.cvG.act.add")}
                        onClick={() => props.onAdd(p.name)}
                        className="cvg-icon-btn cvg-row-add"
                      >
                        <Icon name="plus" size={12} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
        {props.bundles.length > 0 ? (
          <li className="mt-3">
            <div className="flex items-center gap-1.5 px-2 pb-1">
              <span className="h-px w-2 bg-text-tertiary" aria-hidden="true" />
              <span className="text-[11px] text-text-tertiary">
                {t("desktop.craft.canvas.cvG.bundle.word")}
              </span>
            </div>
            <ul>
              {props.bundles.map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    data-row=""
                    data-palette={`bundle:${b.id}`}
                    aria-current={props.focused === `bundle:${b.id}` ? "true" : undefined}
                    onClick={() => props.onPick(`bundle:${b.id}`)}
                    onKeyDown={(e) => rowKey(e, `bundle:${b.id}`, props)}
                    className="cvg-row"
                  >
                    <span className="flex size-[18px] items-center justify-center text-text-secondary">
                      <PartGlyph name="package" size={15} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-text-primary">
                      {bundleMetaOf(b.id).displayName}
                    </span>
                    <span className="text-[10.5px] text-text-tertiary tabular-nums">
                      {String(b.members.length)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ) : null}
      </ul>
      <p className="border-t border-border-subtle px-4 py-2.5 text-[11px] leading-[16px] text-text-tertiary">
        {t("desktop.craft.canvas.cvG.palette.hint")}
      </p>
    </aside>
  );
}

/** 접힌 패널: 종류 타일만 세로로 선다. 누르기·끌기는 그대로 된다 */
function PaletteRail(props: PaletteProps): ReactElement {
  return (
    <aside
      aria-label={t("desktop.craft.canvas.cvG.palette.label")}
      className="cvg-palette flex shrink-0 flex-col items-center gap-1 py-3"
      style={{ width: RAIL_W }}
    >
      <button
        type="button"
        aria-label={t("desktop.craft.canvas.cvG.palette.expand")}
        onClick={props.onToggle}
        className="cvg-icon-btn mb-2"
      >
        <Icon name="right" size={14} />
      </button>
      {ORDER.map((kind) => (
        <ul
          key={kind}
          className="flex flex-col items-center gap-1 border-t border-border-subtle pt-1.5 first-of-type:border-t-0"
        >
          {INSTALLED.filter((p) => p.kind === kind).map((p) => {
            const inside = inProfile(props.profile, p.name);
            return (
              <li key={p.name}>
                <button
                  type="button"
                  data-row=""
                  data-palette={p.name}
                  title={p.name}
                  aria-label={t(
                    inside
                      ? "desktop.craft.canvas.cvG.palette.rowIn"
                      : "desktop.craft.canvas.cvG.palette.row",
                    {
                      name: p.name,
                      kind: t(KIND_WORD[p.kind]),
                    },
                  )}
                  onPointerDown={(e) => props.onPointerDown(p.name, e)}
                  onClick={() => props.onPick(p.name)}
                  onKeyDown={(e) => rowKey(e, p.name, props)}
                  className="cvg-row-rail"
                  style={{ opacity: inside ? 1 : 0.5 }}
                >
                  <KindTile kind={p.kind} size={20} draft={p.meta.review.state === "draft"} />
                </button>
              </li>
            );
          })}
        </ul>
      ))}
    </aside>
  );
}
