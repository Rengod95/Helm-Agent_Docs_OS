import { describe, expect, test } from "bun:test";
import { eachAsync, err, ok, type Result } from "../../src/index.ts";
import type {
  HostedSearchError,
  HostedSearchPort,
  HostedSearchRequest,
  HostedSearchResponse,
  HostedSearchStopReason,
  ModelService,
} from "../../src/services/index.ts";
import type { Assignable, Equal, Expect } from "../types/expect.ts";

export type PortIsOptionalOnModelService = Expect<
  Equal<ModelService["hostedSearch"], HostedSearchPort>
>;
export type StopReasonsAreTheFourSpecValues = Expect<
  Equal<HostedSearchStopReason, "end_turn" | "pause_turn" | "max_tokens" | "refusal">
>;
export type ErrorsAreValues = Expect<Assignable<{ kind: "org_disabled" }, HostedSearchError>>;

const REQUEST: HostedSearchRequest = {
  model: "auto",
  system: "Search the web for the user's query and stop. Do not answer.",
  query: "bun sqlite fts5 trigram",
  maxOutputTokens: 512,
  domains: { allow: [], deny: [] },
  continuation: null,
};

function response(
  stopReason: HostedSearchStopReason,
  continuation: string | null,
): HostedSearchResponse {
  return {
    stopReason,
    text: "",
    results: [{ url: "https://example.com/a", title: "A", pageAge: "2 days ago" }],
    citations: [{ url: "https://example.com/a", title: "A", citedText: "cited" }],
    usage: { inputTokens: 100, outputTokens: 20, searchRequests: 1 },
    model: { provider: "anthropic", modelId: "claude-haiku" },
    continuation,
  };
}

/** 대본대로 응답하는 대역. 받은 요청을 기록한다 */
function scriptedPort(script: readonly Result<HostedSearchResponse, HostedSearchError>[]): {
  readonly port: HostedSearchPort;
  readonly requests: HostedSearchRequest[];
} {
  const requests: HostedSearchRequest[] = [];
  let next = 0;
  const port: HostedSearchPort = {
    support: (model) =>
      model === "none/none"
        ? { supported: false, reason: "no_model" }
        : { supported: true, provider: "anthropic", modelId: "claude-haiku" },
    search: (request) => {
      requests.push(request);
      const step = script[next];
      next += 1;
      return Promise.resolve(
        step ?? err({ kind: "upstream", status: null, message: "script exhausted" }),
      );
    },
  };
  return { port, requests };
}

/** L2.web.spec §4.8.4 4번. pause_turn이면 continuation을 되돌려 보내며 상한까지 다시 요청하는 호출자의 모양 */
async function searchUntilDone(
  port: HostedSearchPort,
  maxContinuations: number,
): Promise<readonly HostedSearchResponse[]> {
  const responses: HostedSearchResponse[] = [];
  let continuation: string | null = null;
  const rounds = Array.from({ length: maxContinuations + 1 }, (_, round) => round);
  await eachAsync(rounds, async () => {
    const result = await port.search({ ...REQUEST, continuation }, new AbortController().signal);
    if (!result.ok) return { value: undefined };
    responses.push(result.value);
    if (result.value.stopReason !== "pause_turn") return { value: undefined };
    continuation = result.value.continuation;
    return undefined;
  });
  return responses;
}

describe("HostedSearchPort contract", () => {
  test("support is answered without a model call", () => {
    const { port, requests } = scriptedPort([]);
    expect(port.support("auto")).toEqual({
      supported: true,
      provider: "anthropic",
      modelId: "claude-haiku",
    });
    expect(port.support("none/none")).toEqual({ supported: false, reason: "no_model" });
    expect(requests).toEqual([]);
  });

  test("an end_turn response carries no continuation", async () => {
    const { port, requests } = scriptedPort([ok(response("end_turn", null))]);
    const responses = await searchUntilDone(port, 3);
    expect(responses.map((r) => r.stopReason)).toEqual(["end_turn"]);
    expect(requests.map((r) => r.continuation)).toEqual([null]);
  });

  test("pause_turn responses are continued with the continuation they returned", async () => {
    const { port, requests } = scriptedPort([
      ok(response("pause_turn", "token-1")),
      ok(response("pause_turn", "token-2")),
      ok(response("end_turn", null)),
    ]);
    const responses = await searchUntilDone(port, 3);
    expect(responses.map((r) => r.stopReason)).toEqual(["pause_turn", "pause_turn", "end_turn"]);
    expect(requests.map((r) => r.continuation)).toEqual([null, "token-1", "token-2"]);
  });

  test("organization blocks, unsupported models and cancellation are error values", async () => {
    const errors: readonly HostedSearchError[] = [
      { kind: "org_disabled" },
      { kind: "unsupported_model", provider: "openai", modelId: "gpt-x" },
      { kind: "rate_limited", retryAfterMs: 1000 },
      { kind: "upstream", status: 529, message: "overloaded" },
      { kind: "cancelled" },
    ];
    const results = await Promise.all(
      errors.map((error) =>
        scriptedPort([err(error)]).port.search(REQUEST, new AbortController().signal),
      ),
    );
    expect(results).toEqual(errors.map((error) => err(error)));
  });
});
