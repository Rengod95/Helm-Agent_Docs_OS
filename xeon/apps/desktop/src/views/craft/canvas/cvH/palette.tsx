// cvH 왼쪽 목록: D의 목록을 바탕으로 한다(프로필 고르기, 종류별 플러그인 줄, 접으면 배지 막대).
// D와 다른 점: 줄을 누르면(Enter·Space도) 캔버스가 그 노드로 움직여 포커스가 간다. 프로필에 없는 플러그인은 상세 패널이 뜬다.
// 넣기는 줄의 + 단추(키보드)나 줄을 캔버스로 끌어 놓기. 묶음은 따로 한 칸에 두고 구성원을 그 아래에 들인다.
import { t } from "@fresnel/client/i18n";
import { Select, SelectOption } from "@caustic/react";
import type { PointerEvent as ReactPointerEvent, ReactElement } from "react";
import { Glyph, KIND_COLOR, KindBadge } from "./glyphs.tsx";
import { ALL_PLUGINS, groupOfMember, hasPlugin, type CanvasProfile, type Kind } from "./model.ts";
import { extOf } from "./sample-ext.ts";
import { INSTALLED_GROUPS } from "./store.ts";
import { KIND_WORD, PROFILE_WORD } from "./words.ts";

const ORDER: readonly Kind[] = ["drive", "inject", "hook", "tool"];
export const PALETTE_W = 256;
export const RAIL_W = 52;

export interface PaletteProps {
  readonly profile: CanvasProfile;
  readonly profiles: readonly ("dev" | "scale" | "empty")[];
  readonly onProfile: (id: string) => void;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly focused: string | null;
  /** 줄 누르기: 캔버스에서 보기 */
  readonly onPick: (key: string) => void;
  readonly onAdd: (name: string) => void;
  readonly onAddGroup: (id: string) => void;
  readonly onPointerDown: (name: string, e: ReactPointerEvent<HTMLElement>) => void;
  readonly scene: "dev" | "scale" | "empty";
}

/** 표본의 설치 목록. 노드 30개 장면이 아니면 그 장면에만 드는 스물은 빼고 보인다 */
function installed(scene: PaletteProps["scene"], profile: CanvasProfile): readonly string[] {
  const names = ALL_PLUGINS.map((p) => p.name);
  if (scene === "scale") return names;
  return names.slice(0, 13).concat(names.slice(13).filter((n) => hasPlugin(profile, n)));
}

function Row(props: {
  readonly name: string;
  readonly kind: Kind;
  readonly inProfile: boolean;
  readonly focused: boolean;
  readonly indent: boolean;
  readonly p: PaletteProps;
}): ReactElement {
  const { name, kind, inProfile } = props;
  const ext = extOf(name);
  const draft = ext?.review === "draft";
  return (
    <div className="group/row flex items-center">
      <button
        type="button"
        data-palette={name}
        aria-label={t(
          inProfile
            ? "desktop.craft.canvas.cvH.palette.rowIn"
            : "desktop.craft.canvas.cvH.palette.row",
          {
            name,
            kind: t(KIND_WORD[kind]),
          },
        )}
        aria-current={props.focused ? "true" : undefined}
        onPointerDown={(e) => {
          props.p.onPointerDown(name, e);
        }}
        onClick={() => {
          props.p.onPick(name);
        }}
        className={`flex h-8 min-w-0 flex-1 items-center gap-2 rounded-[8px] text-left outline-none select-none hover:bg-[var(--cs-color-fill-hover)] focus-visible:outline-2 focus-visible:outline-[var(--cs-color-focus-ring)] ${props.indent ? "ps-5 pe-2" : "px-2"}`}
        style={
          props.focused
            ? { background: `color-mix(in oklab, ${KIND_COLOR[kind]} 13%, transparent)` }
            : undefined
        }
      >
        <KindBadge kind={kind} size={18} draft={draft} />
        <span
          className={`cvh-mono min-w-0 flex-1 truncate text-[12px] ${inProfile ? "text-text-primary" : "text-text-tertiary"}`}
        >
          {name}
        </span>
        {draft && (
          <span className="text-[10.5px] text-[var(--cs-color-warning-text)]">
            {t("desktop.craft.canvas.cvH.review.draft")}
          </span>
        )}
        {inProfile && (
          <span className="text-text-tertiary">
            <Glyph name="right" size={11} />
          </span>
        )}
      </button>
      {!inProfile && (
        <button
          type="button"
          className="cvh-icon-btn size-7 shrink-0"
          aria-label={t("desktop.craft.canvas.cvH.palette.add", { name })}
          title={t("desktop.craft.canvas.cvH.palette.add", { name })}
          onClick={() => {
            props.p.onAdd(name);
          }}
        >
          <Glyph name="plus" size={12} />
        </button>
      )}
    </div>
  );
}

export function Palette(props: PaletteProps): ReactElement {
  if (!props.open) return <PaletteRail {...props} />;
  const names = installed(props.scene, props.profile);
  const groupIds = new Set(props.profile.groups.map((g) => g.id));
  return (
    <aside
      aria-label={t("desktop.craft.canvas.cvH.palette.label")}
      className="absolute top-0 bottom-0 left-0 z-20 flex flex-col border-r border-border-subtle bg-surface-base"
      style={{ width: PALETTE_W }}
    >
      <div className="flex flex-col gap-1.5 px-3 pt-3 pb-3">
        <div className="flex items-center justify-between">
          <span className="px-1 text-[11px] font-medium text-text-tertiary">
            {t("desktop.craft.canvas.cvH.palette.profile")}
          </span>
          <button
            type="button"
            className="cvh-icon-btn size-6"
            aria-label={t("desktop.craft.canvas.cvH.palette.collapse")}
            onClick={props.onToggle}
          >
            <Glyph name="left" size={12} />
          </button>
        </div>
        <Select
          size="sm"
          aria-label={t("desktop.craft.canvas.cvH.palette.profile")}
          value={props.scene}
          onValueChange={props.onProfile}
          className="w-full"
        >
          {props.profiles.map((id) => (
            <SelectOption key={id} value={id}>
              {t(PROFILE_WORD[id])}
            </SelectOption>
          ))}
        </Select>
      </div>
      <div className="mx-3 h-px bg-border-subtle" />
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <span className="text-[11px] font-medium text-text-tertiary">
          {t("desktop.craft.canvas.cvH.palette.plugins")}
        </span>
        <span className="cvh-mono text-[10px] text-text-tertiary tabular-nums">{names.length}</span>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {ORDER.map((kind) => {
          const rows = names.filter(
            (n) =>
              ALL_PLUGINS.find((p) => p.name === n)?.kind === kind &&
              groupOfMember(INSTALLED_GROUPS, n) === undefined,
          );
          if (rows.length === 0) return null;
          return (
            <li key={kind} className="mt-2 first:mt-1">
              <div className="flex items-center gap-1.5 px-2 pb-1">
                <span
                  className="h-[2px] w-2.5 rounded-full"
                  style={{ background: KIND_COLOR[kind] }}
                  aria-hidden="true"
                />
                <span className="text-[11px] text-text-tertiary">{t(KIND_WORD[kind])}</span>
              </div>
              {rows.map((n) => (
                <Row
                  key={n}
                  name={n}
                  kind={kind}
                  inProfile={hasPlugin(props.profile, n)}
                  focused={props.focused === n}
                  indent={false}
                  p={props}
                />
              ))}
            </li>
          );
        })}
        <li className="mt-3">
          <div className="flex items-center gap-1.5 px-2 pb-1">
            <span className="text-text-tertiary">
              <Glyph name="group" size={11} />
            </span>
            <span className="text-[11px] text-text-tertiary">
              {t("desktop.craft.canvas.cvH.palette.groups")}
            </span>
          </div>
          {INSTALLED_GROUPS.map((g) => {
            const inProfile = groupIds.has(g.id);
            return (
              <div key={g.id}>
                <div className="flex items-center">
                  <button
                    type="button"
                    data-palette={`group:${g.id}`}
                    aria-label={t("desktop.craft.canvas.cvH.palette.groupRow", {
                      name: g.id,
                      count: g.members.length,
                    })}
                    aria-current={props.focused === `group:${g.id}` ? "true" : undefined}
                    onClick={() => {
                      props.onPick(`group:${g.id}`);
                    }}
                    className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-[8px] px-2 text-left outline-none hover:bg-[var(--cs-color-fill-hover)] focus-visible:outline-2 focus-visible:outline-[var(--cs-color-focus-ring)]"
                  >
                    <span className="inline-flex size-[18px] items-center justify-center rounded-[5px] border-[1.5px] border-[var(--cvh-rail-soft)] text-text-secondary">
                      <Glyph name="group" size={11} />
                    </span>
                    <span
                      className={`cvh-mono min-w-0 flex-1 truncate text-[12px] ${inProfile ? "text-text-primary" : "text-text-tertiary"}`}
                    >
                      {g.id}
                    </span>
                    <span className="cvh-mono text-[10px] text-text-tertiary">
                      {g.members.length}
                    </span>
                  </button>
                  {!inProfile && (
                    <button
                      type="button"
                      className="cvh-icon-btn size-7 shrink-0"
                      aria-label={t("desktop.craft.canvas.cvH.palette.add", { name: g.id })}
                      onClick={() => {
                        props.onAddGroup(g.id);
                      }}
                    >
                      <Glyph name="plus" size={12} />
                    </button>
                  )}
                </div>
                {g.members.map((m) => {
                  const kind = ALL_PLUGINS.find((p) => p.name === m)?.kind ?? "inject";
                  return (
                    <Row
                      key={m}
                      name={m}
                      kind={kind}
                      inProfile={hasPlugin(props.profile, m)}
                      focused={props.focused === m}
                      indent
                      p={props}
                    />
                  );
                })}
              </div>
            );
          })}
        </li>
      </ul>
    </aside>
  );
}

/** 접힌 목록: 배지만 세로로 선다. 누르면 포커스, 끌면 넣기는 그대로다 */
function PaletteRail(props: PaletteProps): ReactElement {
  const names = installed(props.scene, props.profile);
  return (
    <aside
      aria-label={t("desktop.craft.canvas.cvH.palette.label")}
      className="absolute top-0 bottom-0 left-0 z-20 flex flex-col items-center gap-1 overflow-y-auto border-r border-border-subtle bg-surface-base py-3"
      style={{ width: RAIL_W }}
    >
      <button
        type="button"
        className="cvh-icon-btn mb-2"
        aria-label={t("desktop.craft.canvas.cvH.palette.expand")}
        onClick={props.onToggle}
      >
        <Glyph name="right" size={13} />
      </button>
      {ORDER.map((kind) => (
        <ul
          key={kind}
          className="flex flex-col items-center gap-1 border-t border-border-subtle pt-1.5 first-of-type:border-t-0"
        >
          {names
            .filter((n) => ALL_PLUGINS.find((p) => p.name === n)?.kind === kind)
            .map((n) => {
              const inProfile = hasPlugin(props.profile, n);
              return (
                <li key={n}>
                  <button
                    type="button"
                    data-palette={n}
                    title={n}
                    aria-label={t(
                      inProfile
                        ? "desktop.craft.canvas.cvH.palette.rowIn"
                        : "desktop.craft.canvas.cvH.palette.row",
                      { name: n, kind: t(KIND_WORD[kind]) },
                    )}
                    onPointerDown={(e) => {
                      props.onPointerDown(n, e);
                    }}
                    onClick={() => {
                      props.onPick(n);
                    }}
                    className="inline-flex size-7 items-center justify-center rounded-[8px] outline-none hover:bg-[var(--cs-color-fill-hover)] focus-visible:outline-2 focus-visible:outline-[var(--cs-color-focus-ring)]"
                    style={{ opacity: inProfile ? 1 : 0.45 }}
                  >
                    <KindBadge kind={kind} size={18} draft={extOf(n)?.review === "draft"} />
                  </button>
                </li>
              );
            })}
        </ul>
      ))}
    </aside>
  );
}
