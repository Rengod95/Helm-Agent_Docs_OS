import { attempt, type Logger } from "@xeon/contracts";
import type { CommandActionHandler } from "@xeon/contracts/capabilities";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { ExtHost } from "@xeon/ext-host";
import type { CommandRegistryHolder } from "./l2-units.ts";

// 확장이 `registerCommand`로 올린 슬래시 명령(예: /helm)을 호스트의 명령 서비스(`command.list`·`command.run`)에 잇는다.
// 확장 명령은 ResourceRegistry에만 있고 wire 명령 목록은 cap-dialog의 동작 명령 등록부를 읽으므로, 조립 루트가 둘을 잇는다.
// 조립 루트 코드(DR-14 예외 2).

type ResourceHandler = (
  args: string,
  ctx: { readonly threadId: ThreadId | null; readonly invocationId: string },
) => Promise<void>;

/** 명령 정의에서 처리기를 꺼낸다. 정의의 모양은 X가 보관만 하고 확인하지 않는다(`ResourceRecord.def: unknown`) */
function handlerOf(def: unknown): ResourceHandler | undefined {
  if (typeof def !== "object" || def === null || !("handler" in def)) return undefined;
  const handler: unknown = def.handler;
  if (typeof handler !== "function") return undefined;
  return (args, ctx) => {
    const done: unknown = Reflect.apply(handler, def, [args, ctx]);
    return Promise.resolve(done).then(() => undefined);
  };
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
 * 확장 명령을 동작 명령으로 등록하고, 이후 더해지거나 빠지는 명령을 따라간다. 처리기의 반환은 없으므로 결과 메시지는 비운다
 * (확장이 알림 post로 답한다). 반환 함수는 구독과 등록을 해제한다
 */
export function bridgeExtensionCommands(
  ext: ExtHost,
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
      await run(args.join(" "), { threadId: ctx.threadId, invocationId: ctx.requestId });
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
