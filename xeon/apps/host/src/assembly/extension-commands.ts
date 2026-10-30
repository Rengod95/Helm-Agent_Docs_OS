import { attempt, type Logger } from "@xeon/contracts";
import type { CommandActionHandler, CommandActionResult } from "@xeon/contracts/capabilities";
import { toJsonValue, type ThreadId } from "@xeon/contracts/conversation";
import type { ExtHost } from "@xeon/ext-host";
import type { CommandRegistryHolder } from "./l2-units.ts";

// 확장이 `registerCommand`로 올린 슬래시 명령(예: /helm)을 호스트의 명령 서비스(`command.list`·`command.run`)에 잇는다.
// 확장 명령은 ResourceRegistry에만 있고 wire 명령 목록은 cap-dialog의 동작 명령 등록부를 읽으므로, 조립 루트가 둘을 잇는다.
// 조립 루트 코드(DR-14 예외 2).

type ResourceHandler = (
  args: string,
  ctx: {
    readonly threadId: ThreadId | null;
    readonly invocationId: string;
    readonly signal: AbortSignal;
  },
) => Promise<unknown>;

/** 명령 정의에서 처리기를 꺼낸다. 정의의 모양은 X가 보관만 하고 확인하지 않는다(`ResourceRecord.def: unknown`). 돌려준 값은 아직 검사하지 않은 값이다 */
function handlerOf(def: unknown): ResourceHandler | undefined {
  if (typeof def !== "object" || def === null || !("handler" in def)) return undefined;
  const handler: unknown = def.handler;
  if (typeof handler !== "function") return undefined;
  return (args, ctx) => {
    const done: unknown = Reflect.apply(handler, def, [args, ctx]);
    return Promise.resolve(done);
  };
}

function isMessage(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

/**
 * 처리기의 반환을 동작 명령의 결과로 옮긴다. 반환이 없으면 메시지를 내지 않고(`{message: null}`), 문자열은 메시지가 되고,
 * `{message, result}`는 그대로 옮긴다. 그 밖의 모양은 `undefined`다. 타입 검사로 좁히며 단언은 쓰지 않는다
 */
function resultOf(output: unknown): CommandActionResult | undefined {
  if (output === undefined) return { message: null };
  if (typeof output === "string") return { message: output };
  if (typeof output !== "object" || output === null || !("message" in output)) return undefined;
  const message = output.message;
  if (!isMessage(message)) return undefined;
  if (!("result" in output) || output.result === undefined) return { message };
  const result = toJsonValue(output.result);
  return result === undefined ? undefined : { message, result };
}

function descriptionOf(def: unknown): string {
  if (typeof def === "object" && def !== null && "description" in def) {
    const text = def.description;
    if (typeof text === "string" && text.length > 0) return text.slice(0, 200);
  }
  return "extension command";
}

function keyOf(record: { readonly scopeId: string; readonly exposed: string }): string {
  return `${record.scopeId}:${record.exposed}`;
}

/**
 * 확장 명령을 동작 명령으로 등록하고, 이후 더해지거나 빠지는 명령을 따라간다. 처리기가 돌려준 값은 `command.run`의 `done` 메시지와
 * 결과가 된다(`resultOf`). 처리기는 호출자의 취소 신호(`ctx.signal`)를 받는다. 모양이 맞지 않는 반환은 `ext.command_output_invalid`로
 * 기록하고 메시지 없이 끝낸다. 반환 함수는 구독과 등록을 해제한다
 */
export function bridgeExtensionCommands(
  ext: Pick<ExtHost, "resources">,
  holder: CommandRegistryHolder,
  logger: Logger,
): () => void {
  const unregister = new Map<string, () => void>();
  const add = (record: {
    readonly kind: string;
    readonly scopeId: string;
    readonly exposed: string;
    readonly extension: string;
    readonly def: unknown;
  }): void => {
    if (record.kind !== "command") return;
    const registry = holder.current;
    const run = handlerOf(record.def);
    if (registry === undefined || run === undefined) return;
    const handler: CommandActionHandler = async (args, ctx) => {
      const output = await run(args.join(" "), {
        threadId: ctx.threadId,
        invocationId: ctx.requestId,
        signal: ctx.signal,
      });
      const result = resultOf(output);
      if (result !== undefined) return result;
      logger.warn("ext.command_output_invalid", {
        name: record.exposed,
        extension: record.extension,
      });
      return { message: null };
    };
    const registered = attempt(() =>
      registry.registerAction(
        { name: record.exposed, description: descriptionOf(record.def), origin: record.extension },
        handler,
      ),
    );
    if (registered.ok) unregister.set(keyOf(record), registered.value);
    else
      logger.warn("ext.command_not_bridged", { name: record.exposed, extension: record.extension });
  };

  for (const record of ext.resources.list("command")) add(record);
  const unsubscribe = ext.resources.subscribe((change) => {
    if (change.type === "added") {
      add(change.record);
      return;
    }
    const key = keyOf(change.record);
    unregister.get(key)?.();
    unregister.delete(key);
  });
  return () => {
    unsubscribe();
    for (const off of unregister.values()) off();
    unregister.clear();
  };
}
