import { arch, platform } from "node:os";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { type EngineProcess, HELLO, type Message, processesWithHome } from "./harness.ts";

// 모델 없이 돌릴 수 있는 요청열(G4-03). 컴파일 바이너리에는 테이프 모델을 넣을 길이 없어서(모델은 조립 때 정해진다) turn은 돌리지 않고,
// wire의 나머지 표면(hello, 구독, thread, 설정, 비밀 목록, 승인 목록, 신뢰, 명령 목록)이 같은 바이트열을 내는지를 본다.
// turn의 CLI 대 사이드카 같은 메시지열은 in-process와 stdio(같은 프로세스 쌍)를 견주는 apps/host의 transport-parity 시험이 맡는다.

const DESKTOP = join(import.meta.dir, "..", "..");
export const CLI_MAIN: string = join(DESKTOP, "..", "cli", "src", "main.ts");

const TRIPLES: Readonly<Record<string, string>> = {
  "linux/x64": "x86_64-unknown-linux-gnu",
  "linux/arm64": "aarch64-unknown-linux-gnu",
  "darwin/x64": "x86_64-apple-darwin",
  "darwin/arm64": "aarch64-apple-darwin",
};

/** 이 기기의 사이드카 바이너리 경로. 빌드하지 않았으면 null이다(`just desktop-sidecar host`) */
export function sidecarPath(): string | null {
  const triple = TRIPLES[`${platform()}/${arch()}`];
  if (triple === undefined) return null;
  const path = join(DESKTOP, "src-tauri", "binaries", `xeon-${triple}`);
  return existsSync(path) ? path : null;
}

// ── 정규화 ───────────────────────────────────────────────────────────────

const ID_PATTERN = /^[a-z]{3,4}_[0-9A-HJKMNP-TV-Z]{26}$/;

/** 식별자를 처음 나온 순서의 번호로, 시각과 프로세스 값을 고정 문자열로 바꾼다 */
export function normalizer(): (value: unknown) => unknown {
  const seen = new Map<string, string>();
  function walk(value: unknown, key: string | undefined): unknown {
    if (typeof value === "string" && ID_PATTERN.test(value)) {
      const known = seen.get(value);
      if (known !== undefined) return known;
      const next = `${value.slice(0, value.indexOf("_"))}#${String(seen.size + 1)}`;
      seen.set(value, next);
      return next;
    }
    if (key !== undefined && /(At|Since)$/.test(key) && typeof value === "string") return "time";
    if (key !== undefined && /(At|Ms|^pid)$/.test(key) && typeof value === "number") return 0;
    if (Array.isArray(value)) return value.map((item: unknown) => walk(item, undefined));
    if (typeof value === "object" && value !== null) {
      return Object.fromEntries(
        Object.entries(value).map(([name, item]) => [name, walk(item, name)]),
      );
    }
    return value;
  }
  return (value) => walk(value, undefined);
}

// ── 순서 경합을 시간이 아닌 조건으로 닫는다 ──────────────────────────────

function eventsOf(message: Message): readonly Message[] {
  const params = message["params"];
  if (typeof params !== "object" || params === null) return [];
  const events: unknown = Reflect.get(params, "events");
  return Array.isArray(events)
    ? events.filter((e: unknown): e is Message => typeof e === "object" && e !== null)
    : [];
}

export function allEvents(engine: EngineProcess): readonly Message[] {
  return engine.notifications
    .filter((n) => n["method"] === "events.batch")
    .flatMap(eventsOf)
    .toSorted((a, b) => Number(a["seq"]) - Number(b["seq"]));
}

/**
 * thread를 열면 기본 켜짐 scope의 켜기는 다음 유휴 경계에서 한 번의 커밋(`scope.changed` 묶음)으로 남는다(X.primitives boundary.ts
 * `applyIdleOnce`). 그 커밋이 뒤따르는 입력(`input.queued`)보다 먼저 들어가는지는 시간에 달려 있다(G4-03: 60ms 대기가 이 경합을 가렸다).
 * 시간을 기다리는 대신 이 커밋의 첫 `scope.changed`가 구독으로 도착하기를 기다린다. 커밋은 원자적이라 첫 이벤트가 오면 묶음 전체가 와 있고,
 * 같은 seq 구간의 `scope.changed`가 이어지는지(끊김이 없는지) 확인한 개수를 돌려준다.
 */
export async function untilScopesCommitted(engine: EngineProcess): Promise<number> {
  await engine.waitFor("the scope.changed commit", () =>
    allEvents(engine).some((event) => event["kind"] === "scope.changed"),
  );
  const scopes = allEvents(engine).filter((event) => event["kind"] === "scope.changed");
  const seqs = scopes.map((event) => Number(event["seq"]));
  const first = seqs[0] ?? 0;
  const contiguous = seqs.every((seq, index) => seq === first + index);
  if (!contiguous)
    throw new Error(`scope.changed events are not one contiguous commit: ${seqs.join(",")}`);
  return scopes.length;
}

// ── 요청열 ───────────────────────────────────────────────────────────────

export type ScenarioRun = {
  readonly responses: readonly unknown[];
  readonly events: readonly unknown[];
  readonly scopeCount: number;
  readonly strayStdout: readonly string[];
  readonly home: string;
};

/** 같은 요청열을 보내고 정규화한 응답과 이벤트열을 모은다. 종료는 호출자가 한다 */
export async function runScenario(engine: EngineProcess): Promise<ScenarioRun> {
  const normalize = normalizer();
  const responses: unknown[] = [];
  const ask = async (method: string, params: unknown): Promise<Message> => {
    const reply = await engine.request(method, params);
    responses.push(normalize({ method, reply }));
    return reply;
  };
  await ask("host.hello", HELLO);
  await ask("events.subscribe", { from: "head" });
  const created = await ask("thread.create", { title: "e2e" });
  const result = created["result"];
  const threadId =
    typeof result === "object" && result !== null ? Reflect.get(result, "threadId") : undefined;
  if (typeof threadId !== "string") throw new Error("thread.create did not return a threadId");
  const scopeCount = await untilScopesCommitted(engine);
  await ask("thread.list", {});
  await ask("thread.read", { threadId });
  await ask("settings.get", { keys: ["l1.models.default", "l4.cli.theme"] });
  await ask("approval.list", { threadId });
  await ask("secret.list", {});
  await ask("trust.get", { workspace: engine.home });
  await ask("command.list", {});
  await ask("host.status", {});
  return {
    responses,
    events: allEvents(engine).map((event) => normalize(event)),
    scopeCount,
    strayStdout: engine.strayStdout,
    home: engine.home,
  };
}

export { processesWithHome };
