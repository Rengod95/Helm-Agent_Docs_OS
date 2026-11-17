import type { InvocableEntry, InvocableKind } from "@fresnel/contracts/wire";

// 입력창과 CLI가 같이 쓰는 슬래시 이름 풀이(review/m5/profile-project-loader.md §4.3.9 [제안, 기본값], L4.cli.spec §4.12).
// `/이름`을 `plugin.invocables` 항목으로 푼다. 엔진 명령과 내장 명령은 호출자가 먼저 가린다. 순수 함수만 있다.
//
// 층 순서(위가 먼저):
//   1. 이 대화의 프로필(E(T))에 든 플러그인의 skill·command 항목
//   2. 그 밖의 플러그인의 skill·command 항목
//   3. kind "plugin" 항목(이름 = 플러그인 이름, 플러그인 전체를 얹는다)
// drive 항목은 풀이에 쓰지 않는다. 한 층에서 풀린 플러그인이 둘 이상이면 고르지 않고 `ambiguous`로 돌려준다.
// 한정 문법: `/plugin:<이름>`은 플러그인 전체, `/<플러그인>:<항목>`은 그 플러그인의 skill·command 항목이다.

/** 풀이 결과. `none`이면 슬래시 이름이 아니거나 풀린 항목이 없다 */
export type SlashResolution =
  | { readonly kind: "none" }
  | {
      readonly kind: "resolved";
      readonly overlay: readonly ResolvedOverlay[];
      readonly rest: string;
    }
  | {
      readonly kind: "ambiguous";
      readonly name: string;
      readonly candidates: readonly SlashCandidate[];
    };

/** 풀린 덧씌우기 항목. `entry`가 없으면 플러그인 전체다. `alreadyInProfile`이면 서버에 보내도 아무 일도 없다 */
export interface ResolvedOverlay {
  readonly plugin: string;
  readonly entry?: string;
  readonly alreadyInProfile: boolean;
}

/** 모호할 때 사용자에게 보이는 후보 하나 */
export interface SlashCandidate {
  readonly plugin: string;
  readonly entry: string;
  readonly kind: InvocableKind;
  readonly title: string;
  readonly alreadyInProfile: boolean;
}

const NONE: SlashResolution = { kind: "none" };
/** 한정 접두로 예약한 이름. `/plugin:<이름>`만 이 뜻이다 */
const PLUGIN_QUALIFIER = "plugin";

/** 맨 앞 `/`와 첫 토큰을 나눈다. `/`로 시작하지 않거나 이름이 비었으면 undefined */
function splitLine(input: string): { readonly name: string; readonly rest: string } | undefined {
  const text = input.trim();
  if (!text.startsWith("/")) return undefined;
  const space = text.search(/\s/);
  const name = (space < 0 ? text : text.slice(0, space)).slice(1);
  if (name.length === 0) return undefined;
  return { name, rest: space < 0 ? "" : text.slice(space).trim() };
}

/** 이름으로 얹을 수 있는 항목(스킬·명령) */
function isItem(entry: InvocableEntry): boolean {
  return entry.kind === "skill" || entry.kind === "command";
}

function candidateOf(entry: InvocableEntry, inSet: ReadonlySet<string>): SlashCandidate {
  return {
    plugin: entry.plugin,
    entry: entry.entry,
    kind: entry.kind,
    title: entry.title,
    alreadyInProfile: inSet.has(entry.plugin),
  };
}

/**
 * 한 층에서 고른 항목들을 결과로 바꾼다. 플러그인이 둘 이상이면 모호하다. 한 플러그인의 여러 항목(스킬과 명령이 같은 이름)은 하나로 본다
 */
function pick(
  name: string,
  picked: readonly InvocableEntry[],
  rest: string,
  inSet: ReadonlySet<string>,
): SlashResolution {
  const first = picked[0];
  if (first === undefined) return NONE;
  const plugins = new Set(picked.map((entry) => entry.plugin));
  if (plugins.size > 1) {
    return {
      kind: "ambiguous",
      name,
      candidates: picked.map((entry) => candidateOf(entry, inSet)),
    };
  }
  const alreadyInProfile = inSet.has(first.plugin);
  const overlay: ResolvedOverlay =
    first.kind === "plugin"
      ? { plugin: first.plugin, alreadyInProfile }
      : { plugin: first.plugin, entry: first.entry, alreadyInProfile };
  return { kind: "resolved", overlay: [overlay], rest };
}

/** `/<이름>`(한정 접두 없음)을 층 순서대로 푼다 */
function resolveUnqualified(
  name: string,
  rest: string,
  entries: readonly InvocableEntry[],
  inSet: ReadonlySet<string>,
): SlashResolution {
  const named = entries.filter((entry) => isItem(entry) && entry.entry === name);
  const inProfile = named.filter((entry) => inSet.has(entry.plugin));
  if (inProfile.length > 0) return pick(name, inProfile, rest, inSet);
  const outside = named.filter((entry) => !inSet.has(entry.plugin));
  if (outside.length > 0) return pick(name, outside, rest, inSet);
  const whole = entries.filter((entry) => entry.kind === "plugin" && entry.plugin === name);
  return pick(name, whole, rest, inSet);
}

/**
 * 입력 한 줄의 슬래시 이름을 `plugin.invocables` 항목으로 푼다. `inSet`은 이 대화의 프로필(E(T))에 든 플러그인 이름 집합이다.
 * 순수 함수다: 호출과 출력은 호출자가 맡는다. 내장 명령과 엔진 명령은 이 함수를 부르기 전에 가린다.
 */
export function resolveSlashName(
  input: string,
  entries: readonly InvocableEntry[],
  inSet: ReadonlySet<string>,
): SlashResolution {
  const line = splitLine(input);
  if (line === undefined) return NONE;
  const colon = line.name.indexOf(":");
  if (colon < 0) return resolveUnqualified(line.name, line.rest, entries, inSet);
  // 첫 `:`에서 나눈다. 두 쪽이 모두 있어야 한다
  const head = line.name.slice(0, colon);
  const tail = line.name.slice(colon + 1);
  if (head.length === 0 || tail.length === 0) return NONE;
  if (head === PLUGIN_QUALIFIER) {
    const whole = entries.filter((entry) => entry.kind === "plugin" && entry.plugin === tail);
    return pick(tail, whole, line.rest, inSet);
  }
  const item = entries.filter(
    (entry) => isItem(entry) && entry.plugin === head && entry.entry === tail,
  );
  return pick(tail, item, line.rest, inSet);
}
