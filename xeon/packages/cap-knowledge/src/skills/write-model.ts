import { err, ok, type Result } from "@xeon/contracts";
import { failure, type KnowledgeFailure } from "../errors.ts";
import { parseFrontmatter } from "../upstream/skills.ts";

// L2.knowledge.spec §4.2.2 `SKILL.md`를 만들고 고치는 순수 함수. frontmatter의 다른 키는 글자 그대로 보존한다.

/** 쓰기 한도(spec §4.2.2) */
export const MAX_BODY_CHARS = 100_000;
export const MAX_DESCRIPTION_CHARS = 1_024;
export const MAX_SUPPORT_FILE_BYTES = 1_048_576;
export const MAX_SKILL_FILES = 500;

interface SplitSkillMd {
  /** 여는·닫는 `---` 줄을 뺀 frontmatter 원문. frontmatter가 없으면 null */
  readonly frontmatter: string | null;
  /** 닫는 `---` 뒤의 본문(앞뒤 공백을 지운다) */
  readonly body: string;
}

const BOM = String.fromCodePoint(0xfeff);

/** `upstream/skills.ts`의 frontmatter 경계 규칙과 같다: BOM과 줄바꿈을 정규화하고 `---`로 열고 `\n---`로 닫는다 */
function splitSkillMd(content: string): SplitSkillMd {
  const stripped = content.startsWith(BOM) ? content.slice(1) : content;
  const normalized = stripped.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized.startsWith("---")) return { frontmatter: null, body: normalized.trim() };
  const end = normalized.indexOf("\n---", 3);
  if (end === -1) return { frontmatter: null, body: normalized.trim() };
  return { frontmatter: normalized.slice(4, end), body: normalized.slice(end + 4).trim() };
}

/** frontmatter 원문과 본문을 `SKILL.md` 텍스트로 합친다 */
export function joinSkillMd(frontmatter: string, body: string): string {
  return `---\n${frontmatter.replace(/\n+$/, "")}\n---\n\n${body.trim()}\n`;
}

/** YAML 큰따옴표 스칼라. JSON 문자열은 YAML 1.2의 부분집합이라 줄바꿈과 따옴표, 제어 문자를 안전하게 담는다 */
function yamlString(value: string): string {
  return JSON.stringify(value);
}

/** `create`가 쓰는 새 `SKILL.md`. frontmatter는 `name`과 `description` 두 키다 */
export function composeSkillMd(name: string, description: string, body: string): string {
  return joinSkillMd(`name: ${name}\ndescription: ${yamlString(description)}`, body);
}

/**
 * 최상위 키 하나의 줄들을 새 값으로 바꾼다. 값이 이어지는 줄(들여쓴 줄, 빈 줄)은 그 키에 속한다.
 * 키가 없으면 끝에 더한다. 다른 키와 주석은 글자 그대로 둔다.
 */
function replaceFrontmatterKey(frontmatter: string, key: string, valueText: string): string {
  const lines = frontmatter.split("\n");
  const start = lines.findIndex((line) => new RegExp(`^${key}\\s*:`).test(line));
  const replacement = `${key}: ${valueText}`;
  if (start === -1) {
    const kept = lines.at(-1) === "" ? lines.slice(0, -1) : lines;
    return [...kept, replacement].join("\n");
  }
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end] ?? "";
    if (line !== "" && !/^\s/.test(line)) break;
    end += 1;
  }
  return [...lines.slice(0, start), replacement, ...lines.slice(end)].join("\n");
}

export interface SkillMdParts {
  readonly frontmatter: string;
  readonly body: string;
}

/** 읽을 수 있는 frontmatter가 있는 `SKILL.md`만 고칠 수 있다 */
export function readSkillMd(content: string): Result<SkillMdParts, KnowledgeFailure> {
  const split = splitSkillMd(content);
  if (split.frontmatter === null) {
    return err(
      failure("invalid_input", "SKILL.md has no frontmatter, so it cannot be edited safely"),
    );
  }
  const parsed = parseFrontmatter(content);
  if (!parsed.ok) {
    return err(
      failure("invalid_input", `SKILL.md frontmatter is not readable: ${parsed.error.kind}`),
    );
  }
  return ok({ frontmatter: split.frontmatter, body: split.body });
}

/** 새 설명을 frontmatter에 넣고, 다시 읽어 같은 값인지 확인한다 */
export function withDescription(
  frontmatter: string,
  description: string,
): Result<string, KnowledgeFailure> {
  const next = replaceFrontmatterKey(frontmatter, "description", yamlString(description));
  const parsed = parseFrontmatter(`---\n${next}\n---\n`);
  if (!parsed.ok || parsed.value.frontmatter["description"] !== description) {
    return err(failure("internal", "the description could not be written into the frontmatter"));
  }
  return ok(next);
}

export interface PatchEdit {
  readonly oldText: string;
  readonly newText: string;
}

function occurrences(text: string, needle: string): number {
  if (needle === "") return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const at = text.indexOf(needle, from);
    if (at === -1) return count;
    count += 1;
    from = at + needle.length;
  }
}

/** 정확 일치 치환을 차례로 적용한다. 각 `oldText`는 그 시점의 텍스트에서 정확히 한 번 나와야 한다 */
export function applyEdits(
  text: string,
  edits: readonly PatchEdit[],
): Result<string, KnowledgeFailure> {
  let current = text;
  for (const [index, edit] of edits.entries()) {
    const count = occurrences(current, edit.oldText);
    if (count !== 1) {
      return err(
        failure(
          "patch_mismatch",
          count === 0
            ? `edit ${String(index + 1)}: oldText was not found`
            : `edit ${String(index + 1)}: oldText appears ${String(count)} times`,
          { detail: { edit: index + 1, matches: count } },
        ),
      );
    }
    const at = current.indexOf(edit.oldText);
    current = `${current.slice(0, at)}${edit.newText}${current.slice(at + edit.oldText.length)}`;
  }
  return ok(current);
}
