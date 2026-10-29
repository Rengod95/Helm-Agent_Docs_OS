import { assertNever } from "@xeon/contracts";
import { COMMAND_NAME_PATTERN } from "@xeon/contracts/capabilities";
import type { JsonValue } from "@xeon/contracts/conversation";
import type { CommandListResult, CommandRunResult } from "@xeon/contracts/wire";

// 슬래시 명령 view-model(G1-01, L4.host-service.spec HS-72). 입력창이 `/`로 시작하는 줄을 `command.run`에 보내고,
// `command.list`를 목록·자동완성으로 보인다. 순수 함수만 둔다: 호출과 화면은 앱이 맡는다.

const NAME_PATTERN = new RegExp(COMMAND_NAME_PATTERN);

/** 슬래시로 시작하는 입력 줄. `text`는 사용자가 친 줄 그대로다(`command.run`이 받는 값) */
export type SlashLine = { readonly name: string; readonly text: string };

/**
 * 입력이 슬래시 명령 줄이면 그 이름과 줄 전체를 돌려준다. 첫 줄이 `/이름`(뒤는 공백이나 끝)으로 시작해야 한다.
 * 경로(`/usr/bin`), 이름 규칙에 맞지 않는 `/Foo`는 명령이 아니라 대화 입력이다.
 */
export function slashLineOf(input: string): SlashLine | null {
  if (!input.startsWith("/")) return null;
  const firstLine = input.split("\n", 1)[0] ?? "";
  const name = firstLine.slice(1).split(/\s/, 1)[0] ?? "";
  return NAME_PATTERN.test(name) ? { name, text: input } : null;
}

export type CommandRowVM = {
  readonly name: string;
  /** 입력창에 보이는 이름: `/name` */
  readonly label: string;
  readonly description: string;
  /** 인자 안내(`<sub>`). 없으면 null */
  readonly hint: string | null;
  readonly kind: "template" | "action";
  /** 등록 주체. 표시용 */
  readonly origin: string;
  /** 템플릿 본문에 셸 주입이 있어 실행 전에 확인이 필요하다 */
  readonly needsShellConfirm: boolean;
  /** 첫 인자가 고를 수 있는 값. 없으면 빈 배열 */
  readonly firstChoices: readonly string[];
};

/** `command.list` 결과를 목록 행으로 바꾼다. 이름 순으로 정렬한다 */
export function commandListView(result: CommandListResult): readonly CommandRowVM[] {
  return result.commands
    .map((command): CommandRowVM => ({
      name: command.name,
      label: `/${command.name}`,
      description: command.description,
      hint: command.argumentHint,
      kind: command.kind,
      origin: command.origin,
      needsShellConfirm: command.hasShell,
      firstChoices: command.args[0]?.choices ?? [],
    }))
    .toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * 입력 줄 앞부분으로 후보를 만든다. `/he`는 이름이 `he`로 시작하는 명령이고, `/helm st`처럼 이름 뒤에 공백이 있으면
 * 그 명령의 첫 인자 선택지 중 `st`로 시작하는 것을 `/helm start` 꼴로 돌려준다.
 */
export function completeSlash(rows: readonly CommandRowVM[], typed: string): readonly string[] {
  if (!typed.startsWith("/")) return [];
  const body = typed.slice(1);
  const space = body.search(/\s/);
  if (space === -1) {
    return rows.filter((row) => row.name.startsWith(body)).map((row) => row.label);
  }
  const name = body.slice(0, space);
  const argument = body.slice(space).trimStart();
  if (/\s/.test(argument)) return [];
  const row = rows.find((candidate) => candidate.name === name);
  return (row?.firstChoices ?? [])
    .filter((choice) => choice.startsWith(argument))
    .map((choice) => `/${name} ${choice}`);
}

/** `command.run` 결과를 앱이 할 일 하나로 바꾼다 */
export type SlashStep =
  /** 명령이 아니었다. 줄을 대화 입력으로 보낸다 */
  | { readonly kind: "chat" }
  /** 템플릿이 펼쳐졌다. 이 텍스트를 대화 입력으로 보낸다 */
  | { readonly kind: "send"; readonly name: string; readonly text: string }
  /** 셸 주입 실행에 사람 확인이 필요하다. 확인하면 같은 줄을 `confirmShell: true`로 다시 보낸다 */
  | {
      readonly kind: "confirm";
      readonly name: string;
      readonly commands: readonly string[];
    }
  /** 동작 명령이 끝났다. 메시지와 구조 값을 보인다 */
  | {
      readonly kind: "show";
      readonly name: string;
      readonly message: string | null;
      readonly result: JsonValue;
    };

export function slashStepOf(result: CommandRunResult): SlashStep {
  switch (result.status) {
    case "not_command":
      return { kind: "chat" };
    case "expanded":
      return { kind: "send", name: result.name, text: result.text };
    case "needs_confirmation":
      return {
        kind: "confirm",
        name: result.name,
        commands: result.shell.toSorted((a, b) => a.index - b.index).map((entry) => entry.command),
      };
    case "done":
      return { kind: "show", name: result.name, message: result.message, result: result.result };
    default:
      return assertNever(result, "CommandRunResult");
  }
}
