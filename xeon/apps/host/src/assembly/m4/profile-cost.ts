import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { attemptAsync } from "@fresnel/contracts";
import { parseFrontmatter } from "@fresnel/core-agents";
import { declaredCostOf } from "../plugins/declared-cost.ts";
import type { ProfileCostFigures, ProfilePluginCost, ToolsChanged } from "@fresnel/contracts/wire";

// 프로필 미리 보기의 정적 비용과 도구 변화(M5c §4.2.8, §3.4). 실행하지 않고 매니페스트가 선언한 재료와 그 파일 글자 수만 읽는다.
// 토큰은 조립이 쓰는 추정기(`textTokens`, 글자 수 / 4 올림)로 센다. 선언이 없거나 읽지 못하면 값은 null이고 basis는 unknown이다.
// 드라이브 칸은 선언이 없어 항상 null이다(측정은 E의 `profileCost.get`이 낸다).

/** 매니페스트의 도구 선언 하나(`tools`) */
interface DeclaredTool {
  readonly name: string;
  readonly description: string;
}

/** 플러그인 하나가 선언한 재료. 경로는 확장 폴더 기준 상대 경로다 */
export interface DeclaredInventory {
  /** 코드 플러그인인가(`entry`가 있다). 코드 플러그인이 도구를 선언하지 않으면 비용을 셀 수 없다 */
  readonly code: boolean;
  /** 확장 폴더. 절대 경로가 아니면(내장 단위) 파일을 읽지 못하므로 파일이 있는 재료는 unknown이다 */
  readonly root: string;
  readonly tools: readonly DeclaredTool[];
  /** `components.instructions`: 항상 싣는 지침 파일 */
  readonly instructions: readonly string[];
  /** `components.skills`: 디렉터리면 그 안의 `SKILL.md`, `.md` 파일이면 그 파일이 스킬 하나다 */
  readonly skills: readonly string[];
}

/** 파일 하나의 내용. 없거나 읽지 못하면 undefined다 */
export type ReadText = (path: string) => Promise<string | undefined>;

/** 비용을 셀 수 없을 때의 값 */
export const UNKNOWN_COST: ProfileCostFigures = {
  always: null,
  drive: null,
  onDemand: null,
  toolCount: null,
  basis: "unknown",
};

/** 운영의 파일 읽기. 실패는 undefined로 돌려준다 */
export async function readTextFile(path: string): Promise<string | undefined> {
  const read = await attemptAsync(() => readFile(path, "utf8"));
  return read.ok ? read.value : undefined;
}

/** 확장 폴더 안의 경로만 연다. 밖으로 나가는 경로는 undefined다 */
function insideOf(root: string, rel: string): string | undefined {
  if (!isAbsolute(root)) return undefined;
  const full = resolve(root, rel);
  const back = relative(root, full);
  if (back === ".." || back.startsWith(`..${sep}`) || isAbsolute(back)) return undefined;
  return full;
}

/** 확장 폴더 안의 지침 파일 내용. 경로가 밖이거나 못 읽으면 undefined */
async function readInside(
  root: string,
  rel: string,
  readText: ReadText,
): Promise<string | undefined> {
  const path = insideOf(root, rel);
  return path === undefined ? undefined : readText(path);
}

/** `filter`에 쓰는 값 판정. 값이 있으면 참이다 */
function present<T>(value: T | undefined): value is T {
  return value !== undefined;
}

/** 스킬 하나의 색인 줄(설명)과 본문. 설명이 없거나 못 읽으면 undefined */
async function skillOf(
  root: string,
  rel: string,
  readText: ReadText,
): Promise<{ readonly description: string; readonly body: string } | undefined> {
  const base = insideOf(root, rel);
  if (base === undefined) return undefined;
  const path = rel.endsWith(".md") ? base : join(base, "SKILL.md");
  const text = await readText(path);
  if (text === undefined) return undefined;
  const parsed = parseFrontmatter(text);
  if (!parsed.ok) return undefined;
  const { frontmatter, body } = parsed.value;
  if (typeof frontmatter !== "object" || frontmatter === null) return undefined;
  if (!("description" in frontmatter) || typeof frontmatter.description !== "string") {
    return undefined;
  }
  if (frontmatter.description.trim() === "") return undefined;
  return { description: frontmatter.description, body };
}

/**
 * 플러그인 하나의 정적 비용(카드 `cost`와 같은 모양).
 * - always = 지침 파일 토큰 + 선언된 도구(이름과 설명) 토큰
 * - onDemand = 스킬마다 색인 줄(설명) 토큰 + 본문 토큰
 * - toolCount = 선언된 도구 수
 * 코드 플러그인이 도구를 선언하지 않았거나, 선언된 파일을 읽지 못했으면 `UNKNOWN_COST`다.
 */
export async function pluginCostOf(
  inventory: DeclaredInventory,
  readText: ReadText,
): Promise<ProfileCostFigures> {
  if (inventory.code && inventory.tools.length === 0) return UNKNOWN_COST;
  const texts = await Promise.all(
    inventory.instructions.map((rel) => readInside(inventory.root, rel, readText)),
  );
  const skills = await Promise.all(
    inventory.skills.map((rel) => skillOf(inventory.root, rel, readText)),
  );
  const readableTexts = texts.filter(present);
  const readableSkills = skills.filter(present);
  // 선언한 파일 하나라도 못 읽으면 합계를 셀 수 없다
  if (readableTexts.length !== texts.length || readableSkills.length !== skills.length) {
    return UNKNOWN_COST;
  }
  const figures = declaredCostOf({
    tools: inventory.tools,
    instructions: readableTexts,
    skills: readableSkills,
  });
  return {
    always: figures.always,
    drive: null,
    onDemand: figures.onDemand,
    toolCount: figures.toolCount,
    basis: "declared",
  };
}

/**
 * 해소된 목록의 합계. 한 플러그인이라도 unknown이면 합계도 unknown이다(부분 합을 값처럼 내지 않는다).
 * 드라이브 합계는 플러그인 값이 모두 null이라 null이다.
 */
export function totalCostOf(byPlugin: readonly ProfilePluginCost[]): ProfileCostFigures {
  const figures = byPlugin.map((item) => item.cost);
  if (figures.some((figure) => figure.basis !== "declared")) return UNKNOWN_COST;
  const sum = (pick: (figure: ProfileCostFigures) => number | null): number =>
    figures.reduce((total, figure) => total + (pick(figure) ?? 0), 0);
  return {
    always: sum((figure) => figure.always),
    drive: null,
    onDemand: sum((figure) => figure.onDemand),
    toolCount: sum((figure) => figure.toolCount),
    basis: "declared",
  };
}

/** 두 도구 집합의 차이. 바뀐 것이 없으면 undefined다(응답에서 생략한다) */
export function toolsChangedOf(
  before: ReadonlySet<string>,
  after: ReadonlySet<string>,
): ToolsChanged | undefined {
  const added = [...after].filter((name) => !before.has(name)).toSorted();
  const removed = [...before].filter((name) => !after.has(name)).toSorted();
  if (added.length === 0 && removed.length === 0) return undefined;
  return { added, removed };
}
