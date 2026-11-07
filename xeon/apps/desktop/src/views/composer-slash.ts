import { t } from "@fresnel/client/i18n";
import { slashLineOf, type CommandRowVM } from "@fresnel/client/settings";
import { assertNever } from "@fresnel/contracts";
import type { CommandSource, SkillScope } from "@fresnel/contracts/capabilities";
import type { WireResult } from "@fresnel/contracts/wire";

// 입력창의 슬래시 명령. `/`를 치면 뜨는 목록과, 앱이 직접 하는 명령(`/compact [지침]` → `thread.compact`),
// 모르는 `/명령`을 보내기 전의 확인을 순수하게 정한다(화면은 composer.tsx). 목록 후보는 앱 명령과 엔진 명령(`command.list`)이다.

/** 앱이 입력창에서 직접 하는 명령. 엔진에 같은 이름이 있어도 앱 쪽이 이긴다(CLI `/compact`와 같은 규칙) */
const APP_SLASH_NAMES = ["compact"] as const;

/** 목록 행의 출처. 명령은 `command.list`의 `source`, 스킬은 `knowledge.skills.list`의 `scope`다 */
export type SlashSource = CommandSource | SkillScope;

/** 목록의 한 행 */
export type SlashMenuRow = {
  readonly name: string;
  /** 입력창에 보이는 이름 `/name` */
  readonly label: string;
  readonly description: string;
  /** 인자 안내. 없으면 null */
  readonly hint: string | null;
  /** 묶음. 앱·엔진 명령은 `command`, 대화에 실린 스킬은 `skill` */
  readonly group: "command" | "skill";
  /** 출처 칩의 글(`프로젝트`, `사용자`). 칩이 없으면 null */
  readonly sourceChip: string | null;
};

/** 이 대화가 쓸 수 있는 스킬과 싣지 못한 이유(`knowledge.skills.list`) */
export type SkillsVM = WireResult<"knowledge.skills.list">;

/**
 * 출처 칩의 글. 프로젝트와 사용자 출처에만 붙는다. 내장(`builtin`), 코드 등록(`capability`), 확장(`extension`), 경로(`path`)는
 * 칩이 없다 [결정: 오케스트레이터 기본값, fxPT]
 */
export function slashSourceChipOf(source: SlashSource): string | null {
  switch (source) {
    case "project":
      return t("desktop.composer.slash.source.project");
    case "user":
      return t("desktop.composer.slash.source.user");
    case "builtin":
    case "capability":
    case "extension":
    case "path":
      return null;
    default:
      return assertNever(source, "SlashSource");
  }
}

function appRowsOf(): readonly SlashMenuRow[] {
  return [
    {
      name: "compact",
      label: "/compact",
      description: t("desktop.composer.slash.compact.description"),
      hint: t("desktop.composer.slash.compact.hint"),
      group: "command",
      sourceChip: slashSourceChipOf("builtin"),
    },
  ];
}

function isAppName(name: string): boolean {
  return APP_SLASH_NAMES.some((app) => app === name);
}

/**
 * 입력 글로 목록을 만든다. 글이 `/`로 시작하고 아직 이름을 치는 중(공백도 줄바꿈도 없음)일 때만 보인다.
 * 앱 명령이 먼저, 그 뒤에 엔진 명령이 이름 순으로 온다. 이름은 입력한 글로 시작하는 것만 남긴다.
 */
export function slashMenuOf(
  draft: string,
  engineRows: readonly CommandRowVM[],
  skills: SkillsVM | null = null,
): readonly SlashMenuRow[] {
  if (!draft.startsWith("/") || /\s/.test(draft)) return [];
  const typed = draft.slice(1);
  const engine = engineRows
    .filter((row) => !isAppName(row.name))
    .map((row): SlashMenuRow => ({
      name: row.name,
      label: row.label,
      description: row.description,
      hint: row.hint,
      group: "command",
      sourceChip: slashSourceChipOf(row.source),
    }));
  // 같은 이름의 명령이 있으면 명령이 이긴다. 모델이 못 부르는 스킬은 사용자가 직접 부르는 스킬이라고 알린다
  const taken = new Set([...appRowsOf(), ...engine].map((row) => row.name));
  const skillRows = (skills?.skills ?? [])
    .filter((skill) => !taken.has(skill.name))
    .map((skill): SlashMenuRow => ({
      name: skill.name,
      label: `/${skill.name}`,
      description: skill.description,
      hint: skill.modelInvocable ? null : t("desktop.composer.slash.skills.hidden"),
      group: "skill",
      sourceChip: slashSourceChipOf(skill.scope),
    }));
  return [...appRowsOf(), ...engine, ...skillRows].filter((row) => row.name.startsWith(typed));
}

/**
 * 싣지 못한 스킬의 이유 한 줄씩. 글이 `/`뿐이면 모두, 이름을 치는 중이면 경로에 그 글이 든 것만 낸다(왜 안 보이는지 찾는 사람이 본다).
 * 폴더를 신뢰하지 않아 뺀 알림은 사람 말로 바꾸고, 나머지는 엔진 문구를 그대로 잇는다.
 */
export function slashIssuesOf(draft: string, skills: SkillsVM | null): readonly string[] {
  if (skills === null || !draft.startsWith("/") || /\s/.test(draft)) return [];
  const typed = draft.slice(1);
  return skills.diagnostics
    .filter((item) => typed === "" || item.path.includes(typed))
    .map((item) =>
      item.message.includes("is not trusted")
        ? t("desktop.composer.slash.skills.untrusted")
        : t("desktop.composer.slash.skills.issue", { message: item.message }),
    );
}

/** 목록에서 고른 행이 입력창에 채우는 글. 이어서 인자를 칠 수 있게 공백을 붙인다 */
export function slashFillOf(row: SlashMenuRow): string {
  return `${row.label} `;
}

/** 목록에서 위아래 키로 고르는 자리. 끝에서 반대쪽 끝으로 돈다 */
export function slashMoveOf(index: number, size: number, step: 1 | -1): number {
  if (size === 0) return 0;
  return (index + step + size) % size;
}

/** 앱이 직접 하는 명령으로 풀린 입력 */
export type AppSlash = {
  readonly kind: "compact";
  /** `/compact` 뒤의 나머지. 없으면 null */
  readonly instructions: string | null;
};

/** 입력이 앱 명령이면 그 명령을, 아니면 null. 첫 줄이 이름이고 이름 뒤 나머지(여러 줄 포함)가 지침이다 */
export function appSlashOf(text: string): AppSlash | null {
  const line = slashLineOf(text);
  if (line === null || line.name !== "compact") return null;
  const rest = text.slice("/compact".length).trim();
  return { kind: "compact", instructions: rest === "" ? null : rest };
}

/**
 * 모르는 `/명령`의 이름. 앱 명령도 엔진 명령도 아닌 슬래시 줄이면 그 이름이다.
 * 엔진 명령 목록을 읽지 못했으면(null) 모르는지 알 수 없으므로 null을 돌려 그대로 보낸다.
 */
export function unknownSlashOf(
  text: string,
  engineRows: readonly CommandRowVM[] | null,
  skills: SkillsVM | null = null,
): string | null {
  if (engineRows === null) return null;
  const line = slashLineOf(text);
  if (line === null) return null;
  if (isAppName(line.name)) return null;
  // 대화에 실린 스킬은 모델이 읽는 이름이라 그대로 보낸다
  if (skills?.skills.some((skill) => skill.name === line.name) === true) return null;
  return engineRows.some((row) => row.name === line.name) ? null : line.name;
}
