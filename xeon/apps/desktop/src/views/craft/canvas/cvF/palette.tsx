// cvF 왼쪽 판(cvD의 판을 바탕으로): 지금 보는 프로필(바꾸기)과 묶음·설치된 플러그인 목록.
// 줄을 누르면(마우스·Enter·Space) 캔버스가 그 노드로 움직여 포커스가 간다(접힌 묶음 안이면 펼친다). 프로필 밖의 플러그인은 상세 판이 뜨고 거기서 넣는다.
// 줄 끝의 단추로 넣고 뺀다. 화살표 위·아래로 줄 사이를 옮긴다.
import { t } from "@fresnel/client/i18n";
import { Select, SelectOption } from "@caustic/react";
import type { KeyboardEvent, ReactElement } from "react";
import { KIND_COLOR, KindTile } from "./glyphs.tsx";
import {
  groupIn,
  inProfile,
  isBase,
  type Group,
  type Kind,
  type Plugin,
  type Profile,
} from "./model.ts";
import { zoneLetter } from "./layout.ts";
import { KIND_WORD } from "./words.ts";

const ORDER: readonly Kind[] = ["drive", "inject", "hook", "tool"];

export interface ProfileChoice {
  readonly id: string;
  readonly name: string;
}

/** 화살표로 다음·앞 줄에 초점을 옮긴다 */
function moveFocus(e: KeyboardEvent<HTMLElement>): void {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  const list = e.currentTarget.closest("[data-cvf-palette]");
  if (list === null) return;
  const rows = [...list.querySelectorAll<HTMLElement>("[data-palette-row]")];
  const i = rows.indexOf(e.currentTarget);
  const next = rows[i + (e.key === "ArrowDown" ? 1 : -1)];
  if (next === undefined) return;
  e.preventDefault();
  next.focus();
}

function Mark(props: { readonly on: boolean }): ReactElement {
  return (
    <svg width={12} height={12} viewBox="0 0 12 12" aria-hidden="true">
      <path
        d={props.on ? "M2.5 6.2 5 8.6l4.5-5" : "M6 2.5v7M2.5 6h7"}
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
  readonly profile: Profile;
  readonly installed: readonly Plugin[];
  readonly choices: readonly ProfileChoice[];
  readonly selected: string | null;
  readonly onProfile: (id: string) => void;
  readonly onPick: (name: string) => void;
  readonly onPickGroup: (id: string) => void;
  readonly onToggle: (name: string) => void;
  readonly onToggleGroup: (id: string) => void;
}): ReactElement {
  const { profile } = props;
  return (
    <aside
      aria-label={t("desktop.craft.canvas.cvF.palette.label")}
      data-cvf-palette=""
      className="cvf-palette absolute top-0 bottom-0 left-0 z-20 flex w-[256px] flex-col border-r border-border-subtle bg-surface-base"
    >
      <div className="flex flex-col gap-1.5 px-3 pt-3 pb-3">
        <span className="px-1 text-[11px] font-medium text-text-tertiary">
          {t("desktop.craft.canvas.cvF.profile")}
        </span>
        <Select
          size="sm"
          aria-label={t("desktop.craft.canvas.cvF.profile")}
          value={profile.id}
          onValueChange={props.onProfile}
          className="w-full"
        >
          {props.choices.map((c) => (
            <SelectOption key={c.id} value={c.id}>
              {c.name}
            </SelectOption>
          ))}
        </Select>
      </div>
      <div className="mx-3 h-px bg-border-subtle" />
      <ul className="min-h-0 flex-1 overflow-y-auto px-2 pt-2 pb-3">
        {profile.groups.length > 0 ? (
          <li className="mb-1">
            <Heading
              word={t("desktop.craft.canvas.cvF.palette.groups")}
              count={profile.groups.length}
            />
            <ul>
              {profile.groups.map((g) => (
                <GroupRow
                  key={g.id}
                  group={g}
                  letter={zoneLetter(profile, g.id)}
                  on={groupIn(profile, g)}
                  selected={props.selected === `zone:${g.id}`}
                  onPick={props.onPickGroup}
                  onToggle={props.onToggleGroup}
                />
              ))}
            </ul>
          </li>
        ) : null}
        {ORDER.map((kind) => {
          const rows = props.installed.filter((p) => p.kind === kind);
          if (rows.length === 0) return null;
          return (
            <li key={kind} className="mt-2">
              <Heading word={t(KIND_WORD[kind])} count={rows.length} color={KIND_COLOR[kind]} />
              <ul>
                {rows.map((p) => (
                  <PluginRow
                    key={p.name}
                    plugin={p}
                    on={inProfile(profile, p.name)}
                    base={isBase(profile, p.name)}
                    selected={props.selected === p.name}
                    onPick={props.onPick}
                    onToggle={props.onToggle}
                  />
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

function Heading(props: {
  readonly word: string;
  readonly count: number;
  readonly color?: string;
}): ReactElement {
  return (
    <div className="flex items-center gap-1.5 px-2 pb-1">
      <span
        className="h-px w-2"
        style={{ background: props.color ?? "var(--cs-color-text-tertiary)" }}
        aria-hidden="true"
      />
      <span className="text-[11px] text-text-tertiary">{props.word}</span>
      <span className="ms-auto font-mono text-[10px] text-text-tertiary tabular-nums">
        {props.count}
      </span>
    </div>
  );
}

const ROW =
  "group flex h-8 w-full items-center gap-2 rounded-[8px] ps-2 pe-1 text-left outline-none select-none hover:bg-[var(--cs-color-fill-hover)] focus-visible:outline-2 focus-visible:outline-[var(--cs-color-focus-ring)] data-[selected=true]:bg-[var(--cs-color-fill-selected,var(--cs-color-fill-hover))]";

const TOGGLE =
  "inline-flex size-6 shrink-0 items-center justify-center rounded-[6px] text-text-tertiary outline-none hover:bg-[var(--cs-color-fill-hover)] hover:text-text-primary focus-visible:outline-2 focus-visible:outline-[var(--cs-color-focus-ring)] disabled:opacity-40";

function PluginRow(props: {
  readonly plugin: Plugin;
  readonly on: boolean;
  readonly base: boolean;
  readonly selected: boolean;
  readonly onPick: (name: string) => void;
  readonly onToggle: (name: string) => void;
}): ReactElement {
  const p = props.plugin;
  const pending = p.ext.review.state !== "approved";
  return (
    <li className="flex items-center gap-0.5">
      <button
        type="button"
        data-palette-row=""
        data-palette={p.name}
        data-selected={props.selected}
        aria-label={t(
          props.on
            ? "desktop.craft.canvas.cvF.palette.rowIn"
            : "desktop.craft.canvas.cvF.palette.rowOut",
          { name: p.name, kind: t(KIND_WORD[p.kind]) },
        )}
        className={ROW}
        onClick={() => {
          props.onPick(p.name);
        }}
        onKeyDown={moveFocus}
      >
        <KindTile kind={p.kind} size={18} draft={pending} />
        <span
          className={`min-w-0 flex-1 truncate font-mono text-[12px] ${props.on ? "text-text-primary" : "text-text-tertiary"}`}
        >
          {p.name}
        </span>
        {pending ? (
          <span className="text-[10.5px] text-[var(--cs-color-warning-text)]">
            {t("desktop.craft.canvas.cvF.review.pending")}
          </span>
        ) : null}
        {props.base ? (
          <span className="cvf-chip cvf-hatch text-[10px]">
            {t("desktop.craft.canvas.cvF.base")}
          </span>
        ) : null}
      </button>
      <button
        type="button"
        className={TOGGLE}
        disabled={props.base}
        aria-label={t(
          props.on
            ? "desktop.craft.canvas.cvF.action.remove"
            : "desktop.craft.canvas.cvF.action.add",
          { name: p.name },
        )}
        title={t(
          props.on
            ? "desktop.craft.canvas.cvF.action.remove"
            : "desktop.craft.canvas.cvF.action.add",
          { name: p.name },
        )}
        onClick={() => {
          props.onToggle(p.name);
        }}
      >
        <span className={props.on ? "text-text-secondary" : ""}>
          <Mark on={props.on} />
        </span>
      </button>
    </li>
  );
}

function GroupRow(props: {
  readonly group: Group;
  readonly letter: string;
  readonly on: boolean;
  readonly selected: boolean;
  readonly onPick: (id: string) => void;
  readonly onToggle: (id: string) => void;
}): ReactElement {
  const g = props.group;
  return (
    <li className="flex items-center gap-0.5">
      <button
        type="button"
        data-palette-row=""
        data-palette-group={g.id}
        data-selected={props.selected}
        aria-label={t("desktop.craft.canvas.cvF.palette.group", {
          name: g.id,
          n: g.members.length,
        })}
        className={ROW}
        onClick={() => {
          props.onPick(g.id);
        }}
        onKeyDown={moveFocus}
      >
        <span className="cvf-zone-letter cvf-zone-letter-sm" aria-hidden="true">
          {props.letter}
        </span>
        <span
          className={`min-w-0 flex-1 truncate font-mono text-[12px] ${props.on ? "text-text-primary" : "text-text-tertiary"}`}
        >
          {g.id}
        </span>
        <span className="font-mono text-[10.5px] text-text-tertiary">{g.members.length}</span>
      </button>
      <button
        type="button"
        className={TOGGLE}
        aria-label={t(
          props.on
            ? "desktop.craft.canvas.cvF.action.removeGroup"
            : "desktop.craft.canvas.cvF.action.addGroup",
          { name: g.id },
        )}
        title={t(
          props.on
            ? "desktop.craft.canvas.cvF.action.removeGroup"
            : "desktop.craft.canvas.cvF.action.addGroup",
          { name: g.id },
        )}
        onClick={() => {
          props.onToggle(g.id);
        }}
      >
        <span className={props.on ? "text-text-secondary" : ""}>
          <Mark on={props.on} />
        </span>
      </button>
    </li>
  );
}
