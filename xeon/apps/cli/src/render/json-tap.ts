import { attemptAsync } from "@xeon/contracts";
import type { JsonRpcMessage } from "@xeon/contracts/wire";

// L4.cli.spec §3.3 observe, §4.4 JSON 모드. 연결에서 오간 JSON-RPC 메시지를 순서대로 한 줄에 하나씩 쓴다.
// 출력 여부는 `l4.cli.outputMode`를 읽은 뒤에야 정해질 수 있어서(--json 플래그가 없을 때), 정해지기 전 메시지는 직렬화해
// 모아 둔다. 켜지면 모아 둔 줄을 먼저 쓰고, 꺼지면 버린다. 그래서 켜졌을 때 출력은 host.hello부터 빠짐없이 이어진다.

export type JsonTapMode = "on" | "off" | "undecided";

export interface JsonTap {
  /** EngineConnectOptions.observe에 넘긴다 */
  observe(message: JsonRpcMessage): void;
  /** 출력 여부를 정한다. 한 번 정하면 바꾸지 않는다 */
  decide(enabled: boolean): void;
  readonly mode: JsonTapMode;
  /** 지금까지 쓰기가 모두 끝나기를 기다린다. 쓰기가 실패했으면 그 오류로 거부한다 */
  flush(): Promise<void>;
}

export function createJsonTap(
  write: (line: string) => Promise<void>,
  initial: JsonTapMode,
): JsonTap {
  const state: {
    mode: JsonTapMode;
    buffer: string[];
    chain: Promise<void>;
    failure: { readonly cause: unknown } | undefined;
  } = {
    mode: initial,
    buffer: [],
    chain: Promise.resolve(),
    failure: undefined,
  };
  const emit = (line: string): void => {
    // 쓰기가 한 번 실패하면 뒤 줄은 쓰지 않는다. 실패는 flush가 그 오류로 거부한다
    state.chain = state.chain.then(() => {
      if (state.failure !== undefined) return undefined;
      return attemptAsync(() => write(`${line}\n`)).then((written) => {
        if (!written.ok) state.failure = { cause: written.error.cause };
        return undefined;
      });
    });
  };
  return {
    observe(message) {
      const line = JSON.stringify(message);
      if (state.mode === "on") emit(line);
      else if (state.mode === "undecided") state.buffer.push(line);
    },
    decide(enabled) {
      if (state.mode !== "undecided") return;
      state.mode = enabled ? "on" : "off";
      const pending = state.buffer.splice(0);
      if (enabled) for (const line of pending) emit(line);
    },
    get mode() {
      return state.mode;
    },
    async flush() {
      await state.chain;
      if (state.failure !== undefined) throw state.failure.cause;
    },
  };
}
