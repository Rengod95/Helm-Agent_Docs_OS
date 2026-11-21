import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { attempt, err, ok, type Result } from "@fresnel/contracts";

// 가이드 본문 읽기. 원본은 이 패키지의 `skills/<이름>/SKILL.md`(와 `references/*.md`) 한 벌이고, 두 길이 같은 폴더를 읽는다:
// 1. 호스트가 이 폴더를 스킬 루트로 `cap-knowledge`에 싣는다(그룹이 켜진 때만. `skill_view`로 읽힌다)
// 2. 플러그인 빌더의 `authoring_guide`가 이 읽기 도구로 같은 파일을 내준다(그룹이 꺼져 있어도)

export interface GuideTopic {
  /** 스킬 이름(폴더 이름) */
  readonly name: string;
  readonly description: string;
  /** `SKILL.md` 밖의 참조 파일(스킬 폴더 기준 상대 경로, `/` 구분) */
  readonly files: readonly string[];
}

export type GuideReadError =
  | { readonly kind: "not_found"; readonly message: string }
  | { readonly kind: "io"; readonly message: string };

export interface GuideReader {
  topics(): Result<readonly GuideTopic[], GuideReadError>;
  /** `file`이 없으면 `SKILL.md` 본문(프론트매터 제외), 있으면 그 참조 파일 */
  read(topic: string, file?: string): Result<string, GuideReadError>;
}

const SKILL_FILE = "SKILL.md";
const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?/;

/** 이 패키지 폴더(소스 실행 기준) */
const PACKAGE_DIR = join(import.meta.dir, "..");

/**
 * 가이드 폴더(`skills/`)를 찾는다. 환경 변수 `FRESNEL_GUIDE_SKILLS_DIR`, 릴리즈 자원 폴더의 `guide/skills`, 소스 저장소의
 * `packages/plugin-guide/skills` 순이다. 못 찾으면 undefined다
 */
export function locateGuideSkills(
  env: Readonly<Record<string, string | undefined>>,
  resourceDir?: string,
): string | undefined {
  const candidates: string[] = [];
  const override = env["FRESNEL_GUIDE_SKILLS_DIR"];
  if (override !== undefined && override !== "") candidates.push(override);
  if (resourceDir !== undefined) candidates.push(join(resourceDir, "guide", "skills"));
  candidates.push(join(PACKAGE_DIR, "skills"));
  return candidates.find((candidate) => existsSync(candidate));
}

function ioError(message: string, thrown: { readonly cause: unknown }): GuideReadError {
  const { cause } = thrown;
  return {
    kind: "io",
    message: `${message}: ${cause instanceof Error ? cause.message : String(cause)}`,
  };
}

function descriptionOf(text: string): string {
  const match = FRONTMATTER.exec(text);
  const line = match?.[1]?.split("\n").find((entry) => entry.startsWith("description:"));
  return line === undefined ? "" : line.slice("description:".length).trim();
}

function referencesOf(skillDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name !== SKILL_FILE) {
        out.push(relative(skillDir, full).split(sep).join("/"));
      }
    }
  };
  walk(skillDir);
  return out.toSorted();
}

/** 주제 이름과 파일 경로를 폴더 밖으로 나갈 수 없는 모양으로 푼다 */
function safeJoin(root: string, ...parts: readonly string[]): string | undefined {
  const full = resolve(root, ...parts);
  return full === root || full.startsWith(root + sep) ? full : undefined;
}

export function createGuideReader(dir: string): GuideReader {
  const root = resolve(dir);
  return {
    topics() {
      const listed = attempt(() => readdirSync(root, { withFileTypes: true }));
      if (!listed.ok) return err(ioError("cannot list the guide", listed.error));
      const topics: GuideTopic[] = [];
      for (const entry of listed.value.toSorted((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.isDirectory()) continue;
        const skillDir = join(root, entry.name);
        const file = join(skillDir, SKILL_FILE);
        if (!existsSync(file)) continue;
        const text = attempt(() => readFileSync(file, "utf8"));
        if (!text.ok) return err(ioError(`cannot read ${entry.name}`, text.error));
        const files = attempt(() => referencesOf(skillDir));
        if (!files.ok) return err(ioError(`cannot list ${entry.name}`, files.error));
        topics.push({
          name: entry.name,
          description: descriptionOf(text.value),
          files: files.value,
        });
      }
      return ok(topics);
    },
    read(topic, file) {
      const path = safeJoin(root, topic, file ?? SKILL_FILE);
      const top = safeJoin(root, topic);
      if (path === undefined || top === undefined || dirname(top) !== root) {
        return err({ kind: "not_found", message: `no guide topic ${topic}` });
      }
      const info = attempt(() => statSync(path));
      if (!info.ok || !info.value.isFile()) {
        return err({ kind: "not_found", message: `no guide file ${topic}/${file ?? SKILL_FILE}` });
      }
      const text = attempt(() => readFileSync(path, "utf8"));
      if (!text.ok) return err(ioError(`cannot read ${topic}`, text.error));
      return ok(file === undefined ? text.value.replace(FRONTMATTER, "") : text.value);
    },
  };
}
