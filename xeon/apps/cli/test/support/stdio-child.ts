import { parse, parseJson } from "@xeon/contracts";
import {
  checkEnvelope,
  EventsBatchParamsSchema,
  WIRE_PROTOCOL_VERSION,
  type EventWire,
} from "@xeon/contracts/wire";
import { createEventLog, type EventLog } from "./event-log.ts";

// 실제 자식 프로세스로 도는 호스트(`test/fixtures/scenario-host.ts`)와 JSON Lines로 말하는 시험 도구. 부모가 SIGKILL로 죽이는 시험에 쓴다.

export interface StdioChild {
  readonly log: EventLog;
  /** 요청을 보내고 결과를 기다린다. 오류 응답이면 던진다 */
  request(method: string, params: Readonly<Record<string, unknown>>): Promise<unknown>;
  stderr(): string;
  kill(): void;
  readonly exited: Promise<number>;
}

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

export function spawnStdioChild(options: {
  readonly entry: string;
  readonly home: string;
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>>;
}): StdioChild {
  const proc = Bun.spawn([process.execPath, options.entry], {
    cwd: options.cwd,
    env: { ...process.env, XEON_HOME: options.home, ...options.env },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const log = createEventLog();
  const pending = new Map<string, Pending>();
  const state = { errorText: "", next: 0 };

  const handleLine = (line: string): void => {
    const decoded = parseJson(line);
    if (!decoded.ok) return;
    const checked = checkEnvelope(decoded.value);
    if (!checked.ok) return;
    const message = checked.message;
    if ("method" in message) {
      if (message.method !== "events.batch") return;
      const batch = parse(EventsBatchParamsSchema, message.params);
      if (batch.ok) for (const event of batch.value.events) log.push(event satisfies EventWire);
      return;
    }
    const waiter = typeof message.id === "string" ? pending.get(message.id) : undefined;
    if (waiter === undefined) return;
    pending.delete(String(message.id));
    if ("error" in message) waiter.reject(new Error(JSON.stringify(message.error)));
    else waiter.resolve(message.result);
  };

  const readOut = async (): Promise<void> => {
    const decoder = new TextDecoder();
    let rest = "";
    for await (const chunk of proc.stdout) {
      rest += decoder.decode(chunk, { stream: true });
      const lines = rest.split("\n");
      rest = lines.pop() ?? "";
      for (const line of lines) if (line.length > 0) handleLine(line);
    }
  };
  const readErr = async (): Promise<void> => {
    const decoder = new TextDecoder();
    for await (const chunk of proc.stderr)
      state.errorText += decoder.decode(chunk, { stream: true });
  };

  return {
    log,
    async request(method, params) {
      state.next += 1;
      const id = `r${String(state.next)}`;
      const answer = new Promise<unknown>((resolve, reject) => {
        pending.set(id, { resolve, reject });
      });
      await proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      await proc.stdin.flush();
      return answer;
    },
    stderr: () => state.errorText,
    kill() {
      proc.kill("SIGKILL");
    },
    exited: Promise.all([proc.exited, readOut(), readErr()]).then(([code]) => code),
  };
}

export const HELLO: Readonly<Record<string, unknown>> = {
  protocolVersion: WIRE_PROTOCOL_VERSION,
  client: { name: "xeon-cli-scenario", version: "0.0.0", kind: "other" },
};
