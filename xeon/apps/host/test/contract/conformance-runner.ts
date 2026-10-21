import { parse } from "@xeon/contracts";
import type { JsonObject, JsonValue } from "@xeon/contracts/conversation";
import {
  EventsBatchParamsSchema,
  findBatchIssue,
  WIRE_METHODS,
  type ConformanceCase,
  type ConformanceExpect,
  type ConformanceStep,
  type EventsBatchParams,
  type Transport,
} from "@xeon/contracts/wire";
import { isRecord, rawClient, type RawClient } from "../fixtures/raw-client.ts";

// WIRE_CONFORMANCE_CASES를 한 전송 위에서 돌리는 실행기(F.wire-settings.plan W14, review.decisions-2 U-03: F에는 ./testing이 없어
// 실행기는 쓰는 패키지의 test/ 안에 둔다). 연결 하나에 한 케이스를 돌리고 어긋나면 Error를 던진다.

function isCapture(value: unknown): value is { readonly $capture: string } {
  return (
    isRecord(value) && typeof value["$capture"] === "string" && Object.keys(value).length === 1
  );
}

function substitute(value: JsonValue, captures: ReadonlyMap<string, JsonValue>): JsonValue {
  if (Array.isArray(value)) return value.map((item: JsonValue) => substitute(item, captures));
  if (isCapture(value)) {
    const found = captures.get(value.$capture);
    if (found === undefined) throw new Error(`capture "${value.$capture}" was not taken yet`);
    return found;
  }
  if (typeof value === "object" && value !== null) {
    const out: JsonObject = {};
    for (const [key, member] of Object.entries(value)) out[key] = substitute(member, captures);
    return out;
  }
  return value;
}

function unescapePointer(token: string): string {
  return token.replaceAll("~1", "/").replaceAll("~0", "~");
}

function pointerGet(root: unknown, pointer: string): JsonValue {
  if (pointer === "") return toJson(root);
  let current: unknown = root;
  for (const token of pointer.slice(1).split("/").map(unescapePointer)) {
    if (Array.isArray(current)) current = current[Number(token)];
    else if (isRecord(current)) current = current[token];
    else throw new Error(`pointer ${pointer} does not resolve`);
  }
  return toJson(current);
}

function toJson(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map(toJson);
  if (isRecord(value)) {
    const out: JsonObject = {};
    for (const [key, member] of Object.entries(value)) out[key] = toJson(member);
    return out;
  }
  throw new Error("value is not JSON");
}

/** 기대한 부분 객체가 실제 값에 포함되는가(재귀 부분 일치, 배열은 완전 일치) */
function includes(actual: unknown, expected: JsonValue): boolean {
  if (Array.isArray(expected)) return JSON.stringify(actual) === JSON.stringify(expected);
  if (typeof expected === "object" && expected !== null) {
    if (!isRecord(actual)) return false;
    return Object.entries(expected).every(([key, member]) => includes(actual[key], member));
  }
  return actual === expected;
}

function check(
  expectation: ConformanceExpect,
  response: unknown,
  method: string | undefined,
): void {
  if (!isRecord(response)) throw new Error("the response is not an object");
  if (expectation.outcome === "result") {
    if (!("result" in response)) {
      throw new Error(`expected a result, got ${JSON.stringify(response["error"])}`);
    }
    const spec = method !== undefined && Object.hasOwn(WIRE_METHODS, method) ? method : undefined;
    if (spec !== undefined) {
      for (const [name, entry] of Object.entries(WIRE_METHODS)) {
        if (name !== spec) continue;
        const verdict = parse(entry.result, response["result"]);
        if (!verdict.ok) {
          throw new Error(
            `the ${spec} result breaks its schema: ${JSON.stringify(verdict.error.issues)}`,
          );
        }
      }
    }
    if (expectation.include !== undefined && !includes(response["result"], expectation.include)) {
      throw new Error(
        `result ${JSON.stringify(response["result"])} does not include ${JSON.stringify(expectation.include)}`,
      );
    }
    return;
  }
  const error = response["error"];
  if (!isRecord(error)) throw new Error(`expected an error, got ${JSON.stringify(response)}`);
  if (error["code"] !== expectation.code) {
    throw new Error(`expected code ${expectation.code}, got ${JSON.stringify(error["code"])}`);
  }
  const data = error["data"];
  if (!isRecord(data) || data["kind"] !== expectation.kind) {
    throw new Error(`expected kind ${expectation.kind}, got ${JSON.stringify(data)}`);
  }
  if (expectation.details !== undefined && !includes(data["details"], expectation.details)) {
    throw new Error(
      `details ${JSON.stringify(data["details"])} do not include ${JSON.stringify(expectation.details)}`,
    );
  }
}

function batchesFor(raw: RawClient, sub: string): EventsBatchParams[] {
  const out: EventsBatchParams[] = [];
  for (const { message } of raw.received) {
    if (!isRecord(message) || message["method"] !== "events.batch") continue;
    const parsed = parse(EventsBatchParamsSchema, message["params"]);
    if (!parsed.ok)
      throw new Error(`an events.batch breaks its schema: ${JSON.stringify(parsed.error.issues)}`);
    if (parsed.value.sub === sub) out.push(parsed.value);
  }
  return out;
}

async function runStep(
  step: ConformanceStep,
  raw: RawClient,
  captures: Map<string, JsonValue>,
): Promise<void> {
  switch (step.type) {
    case "request": {
      const params = substitute(step.params, captures);
      await raw.send({ jsonrpc: "2.0", id: step.id, method: step.method, params });
      const { message } = await raw.response(step.id);
      check(substituteExpect(step.expect, captures), message, step.method);
      if (step.capture !== undefined && isRecord(message) && "result" in message) {
        for (const [name, pointer] of Object.entries(step.capture)) {
          captures.set(name, pointerGet(message["result"], pointer));
        }
      }
      return;
    }
    case "raw": {
      await raw.send(step.frame);
      const { message } = await raw.response(step.responseId);
      check(step.expect, message, undefined);
      return;
    }
    case "notify":
      await raw.send({ jsonrpc: "2.0", method: step.method, params: step.params });
      return;
    case "expectBatches": {
      const sub = captures.get(step.sub);
      const start = captures.get(step.start);
      if (typeof sub !== "string" || typeof start !== "number") {
        throw new Error(
          "expectBatches needs the sub id and the start captured as a string and a number",
        );
      }
      await raw.waitFor(
        (message) =>
          isRecord(message) &&
          message["method"] === "events.batch" &&
          isRecord(message["params"]) &&
          message["params"]["sub"] === sub &&
          message["params"]["caughtUp"] === true,
      );
      const batches = batchesFor(raw, sub);
      const issue = findBatchIssue(start, batches);
      if (issue !== undefined)
        throw new Error(`the batches break the interval contract: ${JSON.stringify(issue)}`);
      const kinds = new Set<string>(
        batches.flatMap((batch) => batch.events.map((event) => event.kind)),
      );
      for (const kind of step.includesKinds) {
        if (!kinds.has(kind))
          throw new Error(`no ${kind} event arrived; got ${[...kinds].join(", ")}`);
      }
      // 규칙 4: 응답이 그 구독의 알림보다 먼저다
      const response = raw.received.find(
        (entry) =>
          isRecord(entry.message) &&
          isRecord(entry.message["result"]) &&
          entry.message["result"]["sub"] === sub,
      );
      const first = raw.received.find(
        (entry) =>
          isRecord(entry.message) &&
          entry.message["method"] === "events.batch" &&
          isRecord(entry.message["params"]) &&
          entry.message["params"]["sub"] === sub,
      );
      if (response === undefined || first === undefined || response.index > first.index) {
        throw new Error("an events.batch arrived before its subscribe response");
      }
      return;
    }
    default:
      throw new Error("unknown conformance step");
  }
}

function substituteExpect(
  expectation: ConformanceExpect,
  captures: ReadonlyMap<string, JsonValue>,
): ConformanceExpect {
  if (expectation.outcome === "error") return expectation;
  if (expectation.include === undefined) return expectation;
  const include: JsonObject = {};
  for (const [key, member] of Object.entries(expectation.include)) {
    include[key] = substitute(member, captures);
  }
  return { outcome: "result", include };
}

/** 한 전송 위에서 케이스 하나를 돌린다. 단계를 차례로 실행하며 어긋나면 Error를 던진다 */
export function runConformanceCase(testCase: ConformanceCase, client: Transport): Promise<void> {
  const raw = rawClient(client);
  const captures = new Map<string, JsonValue>();
  return testCase.steps.reduce<Promise<void>>(
    (chain, step) => chain.then(() => runStep(step, raw, captures)),
    Promise.resolve(),
  );
}
