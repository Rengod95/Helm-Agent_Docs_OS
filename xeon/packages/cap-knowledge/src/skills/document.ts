import { parseFrontmatter } from "../upstream/skills.ts";
import { utf8DecodeStrict } from "../hash.ts";
import type { Tree } from "./tree.ts";

// SKILL.md 한 장에서 색인에 필요한 값을 뽑는다. 순수 함수다.

export interface SkillDocument {
  readonly name: string | undefined;
  readonly description: string;
  readonly modelInvocable: boolean;
  /** frontmatter를 뺀 본문 */
  readonly body: string;
}

const MAIN_FILE = "SKILL.md";

/** 트리 안의 스킬 본 파일. 디렉터리 스킬은 SKILL.md, 단일 파일 스킬은 그 파일 하나다 */
export function mainFileOf(tree: Tree, layout: "dir" | "file"): Uint8Array | undefined {
  if (layout === "file") return tree.files[0]?.bytes;
  return tree.files.find((file) => file.path === MAIN_FILE)?.bytes;
}

/** 읽을 수 없거나 설명이 없으면 undefined(색인에 싣지 않는다) */
export function describeSkill(bytes: Uint8Array | undefined): SkillDocument | undefined {
  if (bytes === undefined) return undefined;
  const text = utf8DecodeStrict(bytes);
  if (text === undefined) return undefined;
  const parsed = parseFrontmatter(text);
  if (!parsed.ok) return undefined;
  const { frontmatter, body } = parsed.value;
  const description = frontmatter["description"];
  if (typeof description !== "string" || description.trim() === "") return undefined;
  const name = frontmatter["name"];
  return {
    name: typeof name === "string" && name !== "" ? name : undefined,
    description,
    modelInvocable: frontmatter["disable-model-invocation"] !== true,
    body,
  };
}
