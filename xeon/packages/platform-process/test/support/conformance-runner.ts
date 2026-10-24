import { assertNever, Bug, parse } from "@xeon/contracts";
import type { JsonObject, JsonValue } from "@xeon/contracts/conversation";
import {
  WIRE_METHODS,
  WIRE_NOTIFICATIONS,
  findBatchIssue,
  type ConformanceCase,
  type ConformanceExpect,
  type ConformanceStep,
  type EventsBatchParams,
} from "@xeon/contracts/wire";

// F.wire-settings.plan W14의 실행기 틀. WIRE_CONFORMANCE_CASES(데이터)를 연결 끝점 하나에 돌린다.
// F에서는 메모리 가짜 호스트로 자기 검사만 한다. in-process와 stdio 실제 구현은 L4.host-service의 test/contract/에서
// 같은 케이스를 같은 방식으로 돌린다(review.decisions-2 U-03: F에는 testing 서브패스를 두지 않는다).

/** 전송 종류와 무관한 연결 끝점. in-process는 객체를 그대로, stdio는 JSON Lines 한 줄로 옮긴다 */
export interface ConformanceLink {
  /** 프레임을 있는 그대로 보낸다. 규칙을 어긴 프레임도 보낼 수 있어야 한다 */
  send(frame: unknown): Promise<void>;
  /** 서버가 보내는 메시지(응답과 알림)를 받는다 */
  onMessage(handler: (message: unknown) => void): () => void;
}

export interface ConformanceFailure {
  readonly caseId: string;
  /** 0부터 센 단계 번호 */
  readonly step: number;
  readonly message: string;
}

export interface RunOptions {
  /** 응답을 기다리는 안전 시한. 기본 2000ms */
  readonly timeoutMs?: number;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCaptureMarker(value: unknown): value is { readonly $capture: string } {
  return (
    isRecord(value) && Object.keys(value).length === 1 && typeof value["$capture"] === "string"
  );
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function substitute(value: JsonValue, captures: ReadonlyMap<string, JsonValue>): JsonValue {
  if (isCaptureMarker(value)) {
    const found = captures.get(value.$capture);
    if (found === undefined) throw new Bug(`capture "${value.$capture}" was not set`);
    return found;
  }
  if (Array.isArray(value)) return value.map((element: JsonValue) => substitute(element, captures));
  if (isJsonObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, substitute(inner, captures)]),
    );
  }
  return value;
}

/** 재귀 부분 일치: 객체는 기대한 키만 보고, 배열과 원시 값은 완전히 같아야 한다 */
function includes(actual: unknown, expected: JsonValue): boolean {
  if (isJsonObject(expected)) {
    if (!isRecord(actual)) return false;
    return Object.entries(expected).every(([key, inner]) => includes(actual[key], inner));
  }
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function pointerGet(root: unknown, pointer: string): unknown {
  if (pointer === "") return root;
  let node: unknown = root;
  for (const raw of pointer.slice(1).split("/")) {
    const token = raw.replaceAll("~1", "/").replaceAll("~0", "~");
    if (Array.isArray(node)) node = node[Number(token)];
    else if (isRecord(node)) node = node[token];
    else return undefined;
  }
  return node;
}

function toJson(value: unknown): JsonValue {
  const copy: JsonValue = JSON.parse(JSON.stringify(value));
  return copy;
}

class Inbox {
  private readonly queue: unknown[] = [];
  private readonly timeoutMs: number;
  private waiter: (() => void) | undefined;

  constructor(timeoutMs: number) {
    this.timeoutMs = timeoutMs;
  }

  push(message: unknown): void {
    this.queue.push(message);
    this.waiter?.();
  }

  /** 조건에 맞는 첫 메시지를 꺼낸다. 맞지 않는 것은 큐에 남는다 */
  async take(match: (message: unknown) => boolean, what: string): Promise<unknown> {
    const index = this.queue.findIndex(match);
    if (index >= 0) return this.queue.splice(index, 1)[0];
    await this.nextPush(what);
    return this.take(match, what);
  }

  private nextPush(what: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = undefined;
        reject(new Bug(`timed out waiting for ${what}`));
      }, this.timeoutMs);
      this.waiter = () => {
        clearTimeout(timer);
        this.waiter = undefined;
        resolve();
      };
    });
  }
}

function isResponseTo(id: string | null): (message: unknown) => boolean {
  return (message) => isRecord(message) && !("method" in message) && message["id"] === id;
}

function checkExpect(
  expect: ConformanceExpect,
  response: unknown,
  method: string | undefined,
  captures: ReadonlyMap<string, JsonValue>,
): void {
  if (!isRecord(response)) throw new Bug("response is not an object");
  if (expect.outcome === "error") {
    const error = response["error"];
    if (!isRecord(error))
      throw new Bug(`expected error ${expect.kind}, got ${JSON.stringify(response)}`);
    const data = error["data"];
    if (error["code"] !== expect.code)
      throw new Bug(`expected code ${expect.code}, got ${String(error["code"])}`);
    if (!isRecord(data) || data["kind"] !== expect.kind) {
      throw new Bug(`expected kind ${expect.kind}, got ${JSON.stringify(data)}`);
    }
    if (expect.details !== undefined) {
      const details = substitute(expect.details, captures);
      if (!includes(data["details"], details)) {
        throw new Bug(
          `details ${JSON.stringify(data["details"])} do not include ${JSON.stringify(details)}`,
        );
      }
    }
    return;
  }
  const result = response["result"];
  if (!isRecord(result)) throw new Bug(`expected a result, got ${JSON.stringify(response)}`);
  const spec = Object.entries(WIRE_METHODS).find(([name]) => name === method)?.[1];
  if (spec !== undefined) {
    const checked = parse(spec.result, result);
    if (!checked.ok)
      throw new Bug(
        `result of ${method} breaks its schema: ${JSON.stringify(checked.error.issues)}`,
      );
  }
  if (expect.include !== undefined) {
    const wanted = substitute(expect.include, captures);
    if (!includes(result, wanted)) {
      throw new Bug(`result ${JSON.stringify(result)} does not include ${JSON.stringify(wanted)}`);
    }
  }
}

/** caughtUp: true인 알림까지 해당 구독의 events.batch를 모은다 */
async function collectBatches(
  inbox: Inbox,
  sub: string,
  seen: readonly EventsBatchParams[],
): Promise<readonly EventsBatchParams[]> {
  const message = await inbox.take(
    (candidate) =>
      isRecord(candidate) &&
      candidate["method"] === "events.batch" &&
      isRecord(candidate["params"]) &&
      candidate["params"]["sub"] === sub,
    "the next events.batch",
  );
  const params = isRecord(message) ? message["params"] : undefined;
  const checked = parse(WIRE_NOTIFICATIONS["events.batch"].params, params);
  if (!checked.ok) {
    throw new Bug(`events.batch breaks its schema: ${JSON.stringify(checked.error.issues)}`);
  }
  const next = [...seen, checked.value];
  return checked.value.caughtUp ? next : collectBatches(inbox, sub, next);
}

async function runStep(
  step: ConformanceStep,
  link: ConformanceLink,
  inbox: Inbox,
  captures: Map<string, JsonValue>,
): Promise<void> {
  switch (step.type) {
    case "request": {
      const params = substitute(step.params, captures);
      await link.send({ jsonrpc: "2.0", id: step.id, method: step.method, params });
      const response = await inbox.take(isResponseTo(step.id), `the response to ${step.id}`);
      checkExpect(step.expect, response, step.method, captures);
      if (step.capture !== undefined && isRecord(response) && "result" in response) {
        for (const [name, pointer] of Object.entries(step.capture)) {
          const value = pointerGet(response["result"], pointer);
          if (value === undefined) throw new Bug(`capture ${name}: ${pointer} is missing`);
          captures.set(name, toJson(value));
        }
      }
      return;
    }
    case "raw": {
      await link.send(step.frame);
      const response = await inbox.take(
        isResponseTo(step.responseId),
        `the error response to a raw frame (id ${String(step.responseId)})`,
      );
      checkExpect(step.expect, response, undefined, captures);
      return;
    }
    case "notify":
      await link.send({ jsonrpc: "2.0", method: step.method, params: step.params });
      return;
    case "expectBatches": {
      const sub = captures.get(step.sub);
      const start = captures.get(step.start);
      if (typeof sub !== "string" || typeof start !== "number") {
        throw new Bug(
          `captures "${step.sub}" and "${step.start}" must be a sub id and a start seq`,
        );
      }
      const batches = await collectBatches(inbox, sub, []);
      const issue = findBatchIssue(start, batches);
      if (issue !== undefined)
        throw new Bug(`batch interval contract broken: ${JSON.stringify(issue)}`);
      const kinds = new Set<string>(
        batches.flatMap((batch) => batch.events.map((event) => event.kind)),
      );
      for (const kind of step.includesKinds) {
        if (!kinds.has(kind)) throw new Bug(`no event of kind ${kind} was delivered`);
      }
      return;
    }
    default:
      return assertNever(step, "ConformanceStep");
  }
}

/** 케이스 하나를 돌려 실패하면 어느 단계에서 왜 실패했는지 돌려준다. 통과하면 undefined */
export async function runConformanceCase(
  testCase: ConformanceCase,
  link: ConformanceLink,
  options: RunOptions = {},
): Promise<ConformanceFailure | undefined> {
  const inbox = new Inbox(options.timeoutMs ?? 2000);
  const stop = link.onMessage((message) => inbox.push(message));
  const captures = new Map<string, JsonValue>();

  async function runFrom(index: number): Promise<ConformanceFailure | undefined> {
    const step = testCase.steps[index];
    if (step === undefined) return undefined;
    try {
      await runStep(step, link, inbox, captures);
    } catch (cause) {
      return {
        caseId: testCase.id,
        step: index,
        message: cause instanceof Error ? cause.message : String(cause),
      };
    }
    return runFrom(index + 1);
  }

  try {
    return await runFrom(0);
  } finally {
    stop();
  }
}
