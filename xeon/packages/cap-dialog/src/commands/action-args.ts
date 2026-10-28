import type { CommandArg } from "@xeon/contracts/capabilities";

// L2.dialog.spec §4.2.4 2번. 동작 명령 인자를 `args` 선언으로 검사한다. 선언이 없으면 아무 인자나 받는다.

/** 선언을 어기면 사유 문장을, 맞으면 undefined를 돌려준다 */
export function checkActionArgs(
  declared: readonly CommandArg[],
  args: readonly string[],
): string | undefined {
  if (declared.length === 0) return undefined;
  const last = declared.at(-1);
  const hasRest = last?.rest === true;
  if (!hasRest && args.length > declared.length) {
    return `Too many arguments: at most ${declared.length} are accepted, got ${args.length}.`;
  }
  for (const [index, arg] of declared.entries()) {
    const value = arg.rest === true ? args.slice(index).join(" ") : args[index];
    const missing = value === undefined || value === "";
    if (missing) {
      if (arg.required === true) return `The argument "${arg.name}" is required.`;
      continue;
    }
    if (arg.choices !== undefined && arg.rest !== true && !arg.choices.includes(value)) {
      return `The argument "${arg.name}" must be one of: ${arg.choices.join(", ")}.`;
    }
  }
  return undefined;
}
