// 바로 가기 키 표(V-15). 모든 키는 동작 id에 묶이고 `l4.desktop.appearance.keybindings`(동작 id → 키)로 바꾼다.
// 기본 표의 정본은 L4.desktop-ux.spec §4.8이다. `Mod`는 macOS ⌘, 그 밖의 Ctrl이다.

export const ACTION_IDS = [
  "palette.open",
  "thread.new",
  "nav.1",
  "nav.2",
  "nav.3",
  "nav.4",
  "nav.5",
  "nav.6",
  "settings.open",
  "sidebar.toggle",
  "panel.toggle",
  "panel.inbox",
  "panel.helm",
  "panel.work",
  "turn.interrupt",
  "composer.focus",
  "thread.next",
  "thread.prev",
  "approval.next",
  "help.shortcuts",
  "area.toggle",
  "area.chat",
  "area.workbench",
] as const;

export type ActionId = (typeof ACTION_IDS)[number];

/** 키 표기: `Mod+Shift+I`처럼 수식키를 `+`로 잇고 마지막이 글쇠다. Alt가 있으면 글쇠는 `KeyboardEvent.code`(`Digit1`, `ArrowDown`)로 본다 */
export type KeySpec = string;
export type Keymap = Readonly<Record<ActionId, KeySpec>>;

export const DEFAULT_KEYMAP: Keymap = {
  "palette.open": "Mod+K",
  "thread.new": "Mod+N",
  "nav.1": "Mod+1",
  "nav.2": "Mod+2",
  "nav.3": "Mod+3",
  "nav.4": "Mod+4",
  "nav.5": "Mod+5",
  "nav.6": "Mod+6",
  "settings.open": "Mod+,",
  "sidebar.toggle": "Mod+\\",
  "panel.toggle": "Mod+J",
  "panel.inbox": "Mod+Shift+I",
  "panel.helm": "Mod+Shift+H",
  "panel.work": "Mod+Shift+T",
  "turn.interrupt": "Mod+.",
  "composer.focus": "Mod+L",
  "thread.next": "Mod+Alt+ArrowDown",
  "thread.prev": "Mod+Alt+ArrowUp",
  "approval.next": "Mod+Shift+A",
  "help.shortcuts": "Mod+/",
  "area.toggle": "Mod+E",
  "area.chat": "Mod+Alt+Digit1",
  "area.workbench": "Mod+Alt+Digit2",
};

export interface KeyEventLike {
  readonly key: string;
  readonly code: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

interface ParsedKey {
  readonly mod: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
  readonly key: string;
}

function parseKeySpec(spec: KeySpec): ParsedKey | null {
  const parts = spec.split("+");
  // 글쇠가 `+`인 표기(`Mod++`)는 마지막 두 조각이 빈 문자열과 빈 문자열로 갈린다
  const key = spec.endsWith("++") ? "+" : (parts[parts.length - 1] ?? "");
  const mods = spec.endsWith("++") ? parts.slice(0, -2) : parts.slice(0, -1);
  if (key === "") return null;
  const known = new Set(["Mod", "Shift", "Alt"]);
  if (mods.some((m) => !known.has(m))) return null;
  return {
    mod: mods.includes("Mod"),
    shift: mods.includes("Shift"),
    alt: mods.includes("Alt"),
    key,
  };
}

/** 키 이벤트가 이 표기와 맞는가. 수식키는 정확히 같아야 한다(여분의 Shift·Alt가 있으면 다른 키) */
function matchesKey(spec: KeySpec, e: KeyEventLike, mac: boolean): boolean {
  const p = parseKeySpec(spec);
  if (p === null) return false;
  const modDown = mac ? e.metaKey : e.ctrlKey;
  const otherMod = mac ? e.ctrlKey : e.metaKey;
  if (modDown !== p.mod || otherMod || e.shiftKey !== p.shift || e.altKey !== p.alt) return false;
  return p.alt ? e.code === p.key : e.key.toLowerCase() === p.key.toLowerCase();
}

/** 기본 표 위에 사용자가 바꾼 키를 얹는다. 모르는 동작 id나 읽을 수 없는 키 표기는 버리고 기본 키를 쓴다 */
export function resolveKeymap(overrides: Readonly<Record<string, string>> | undefined): Keymap {
  const merged: Record<ActionId, KeySpec> = { ...DEFAULT_KEYMAP };
  if (overrides === undefined) return merged;
  for (const id of ACTION_IDS) {
    const spec = Object.hasOwn(overrides, id) ? overrides[id] : undefined;
    if (spec !== undefined && parseKeySpec(spec) !== null) merged[id] = spec;
  }
  return merged;
}

/** 키 이벤트가 가리키는 동작. 맞는 것이 없으면 null */
export function actionFor(keymap: Keymap, e: KeyEventLike, mac: boolean): ActionId | null {
  for (const id of ACTION_IDS) {
    if (matchesKey(keymap[id], e, mac)) return id;
  }
  return null;
}

/** 같은 키를 두 동작이 쓰면 그 동작 id 묶음을 돌려준다(설정 화면이 막는다) */
export function keyConflicts(keymap: Keymap): readonly (readonly ActionId[])[] {
  const byKey = new Map<string, ActionId[]>();
  for (const id of ACTION_IDS) {
    const p = parseKeySpec(keymap[id]);
    const norm = p === null ? keymap[id] : `${p.mod}|${p.shift}|${p.alt}|${p.key.toLowerCase()}`;
    byKey.set(norm, [...(byKey.get(norm) ?? []), id]);
  }
  return [...byKey.values()].filter((ids) => ids.length > 1);
}

const MAC_GLYPH: Readonly<Record<string, string>> = {
  ArrowDown: "↓",
  ArrowUp: "↑",
  Digit1: "1",
  Digit2: "2",
};

/** 화면에 보일 키 글자. macOS는 ⌘⇧⌥ 기호, 그 밖은 `Ctrl+Shift+`다 */
export function formatKey(spec: KeySpec, mac: boolean): string {
  const p = parseKeySpec(spec);
  if (p === null) return spec;
  const key = MAC_GLYPH[p.key] ?? (p.key.length === 1 ? p.key.toUpperCase() : p.key);
  if (mac) return `${p.alt ? "⌥" : ""}${p.shift ? "⇧" : ""}${p.mod ? "⌘" : ""}${key}`;
  return [p.mod ? "Ctrl" : null, p.alt ? "Alt" : null, p.shift ? "Shift" : null, key]
    .filter((x) => x !== null)
    .join("+");
}
