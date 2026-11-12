import {
  ACTION_IDS,
  DEFAULT_KEYMAP,
  actionFor,
  resolveKeymap,
  type ActionId,
  type KeyEventLike,
  type KeySpec,
  type Keymap,
} from "../../shell/keybindings.ts";

// 설정 "단축키" 구역의 순수 모델(DP-89 [결정: 2026-11-11 사용자]). 키 이벤트를 키 표기로 바꾸고(기록), 같은 키를 쓰는 동작을 찾고,
// 기본 표와 다른 것만 사용자 값(`l4.desktop.appearance.keybindings`)으로 남긴다. DOM과 저장은 보지 않는다.

/** 수식키만 눌린 이벤트의 글쇠 이름. 이것만 눌리면 아직 기록하지 않는다 */
const MODIFIER_KEYS: ReadonlySet<string> = new Set(["Meta", "Control", "Shift", "Alt", "OS"]);

/** 키 이벤트 하나를 기록한 결과 */
export type RecordStep =
  /** 수식키만 눌렸다. 계속 기다린다 */
  | { readonly kind: "waiting" }
  /** Esc: 기록을 그만둔다 */
  | { readonly kind: "cancel" }
  /** ⌘(Ctrl)나 ⌥ 없이 누른 글쇠. 입력창 글자와 겹치므로 받지 않는다 */
  | { readonly kind: "needsModifier" }
  | { readonly kind: "key"; readonly spec: KeySpec };

/**
 * 키 이벤트를 키 표기로 바꾼다(`keybindings.ts`의 읽기와 짝). ⌥가 있으면 글쇠는 `code`(`Digit1`, `KeyK`)이고, 없으면 `key`(한 글자는 대문자)다.
 * macOS는 ⌘가 Mod이고 Ctrl은 받지 않는다. 그 밖은 Ctrl이 Mod이고 ⌘(Win)는 받지 않는다.
 */
export function recordStepOf(event: KeyEventLike, mac: boolean): RecordStep {
  if (event.key === "Escape") return { kind: "cancel" };
  if (MODIFIER_KEYS.has(event.key)) return { kind: "waiting" };
  const mod = mac ? event.metaKey : event.ctrlKey;
  const other = mac ? event.ctrlKey : event.metaKey;
  if (other || (!mod && !event.altKey)) return { kind: "needsModifier" };
  const key = event.altKey
    ? event.code
    : event.key.length === 1
      ? event.key.toUpperCase()
      : event.key;
  if (key === "") return { kind: "needsModifier" };
  const parts = [mod ? "Mod" : null, event.shiftKey ? "Shift" : null, event.altKey ? "Alt" : null];
  return { kind: "key", spec: [...parts.filter((part) => part !== null), key].join("+") };
}

/** 표기 하나를 그 키를 누른 이벤트로 바꾼다(충돌 찾기에 `actionFor`를 그대로 쓰려고) */
function eventOf(spec: KeySpec, mac: boolean): KeyEventLike | null {
  const parts = spec.endsWith("++") ? [...spec.slice(0, -2).split("+"), "+"] : spec.split("+");
  const key = parts[parts.length - 1];
  if (key === undefined || key === "") return null;
  const mods = new Set(parts.slice(0, -1));
  const alt = mods.has("Alt");
  return {
    key: alt ? "" : key,
    code: alt ? key : "",
    metaKey: mac && mods.has("Mod"),
    ctrlKey: !mac && mods.has("Mod"),
    shiftKey: mods.has("Shift"),
    altKey: alt,
  };
}

/** `spec`을 이미 쓰는 다른 동작. 없으면 null이다 */
export function conflictOf(
  keymap: Keymap,
  id: ActionId,
  spec: KeySpec,
  mac: boolean,
): ActionId | null {
  const event = eventOf(spec, mac);
  if (event === null) return null;
  const others: Keymap = { ...keymap, [id]: "" };
  return actionFor(others, event, mac);
}

/** 기본 표와 다른 키만 남긴 사용자 값. 기본과 같으면 빠진다 */
export function overridesOf(keymap: Keymap): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const id of ACTION_IDS) {
    if (keymap[id] !== DEFAULT_KEYMAP[id]) out[id] = keymap[id];
  }
  return out;
}

/** 한 동작의 키를 바꾼 새 사용자 값 */
export function withKey(
  overrides: Readonly<Record<string, string>> | undefined,
  id: ActionId,
  spec: KeySpec,
): Readonly<Record<string, string>> {
  return overridesOf({ ...resolveKeymap(overrides), [id]: spec });
}

/** 한 동작을 기본 키로 되돌린 새 사용자 값 */
export function withDefault(
  overrides: Readonly<Record<string, string>> | undefined,
  id: ActionId,
): Readonly<Record<string, string>> {
  return withKey(overrides, id, DEFAULT_KEYMAP[id]);
}

/** 이 동작을 `spec`으로 바꾸고 그 키를 쓰던 동작은 기본 키로 되돌린다("바꿔 쓰기") */
export function withSwap(
  overrides: Readonly<Record<string, string>> | undefined,
  id: ActionId,
  spec: KeySpec,
  other: ActionId,
): Readonly<Record<string, string>> {
  return withKey(withDefault(overrides, other), id, spec);
}
