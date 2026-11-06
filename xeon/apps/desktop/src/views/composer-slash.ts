import { t } from "@fresnel/client/i18n";
import { slashLineOf, type CommandRowVM } from "@fresnel/client/settings";

// 입력창의 슬래시 명령. `/`를 치면 뜨는 목록과, 앱이 직접 하는 명령(`/compact [지침]` → `thread.compact`),
// 모르는 `/명령`을 보내기 전의 확인을 순수하게 정한다(화면은 composer.tsx). 목록 후보는 앱 명령과 엔진 명령(`command.list`)이다.

/** 앱이 입력창에서 직접 하는 명령. 엔진에 같은 이름이 있어도 앱 쪽이 이긴다(CLI `/compact`와 같은 규칙) */
const APP_SLASH_NAMES = ["compact"] as const;

/** 목록의 한 행 */
export type SlashMenuRow = {
  readonly name: string;
  /** 입력창에 보이는 이름 `/name` */
  readonly label: string;
  readonly description: string;
  /** 인자 안내. 없으면 null */
  readonly hint: string | null;
};

function appRowsOf(): readonly SlashMenuRow[] {
  return [
    {
      name: "compact",
      label: "/compact",
      description: t("desktop.composer.slash.compact.description"),
      hint: t("desktop.composer.slash.compact.hint"),
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
    }));
  return [...appRowsOf(), ...engine].filter((row) => row.name.startsWith(typed));
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
): string | null {
  if (engineRows === null) return null;
  const line = slashLineOf(text);
  if (line === null) return null;
  if (isAppName(line.name)) return null;
  return engineRows.some((row) => row.name === line.name) ? null : line.name;
}
