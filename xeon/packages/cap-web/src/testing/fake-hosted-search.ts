import { err, ok, parse, parseJson, type Result } from "@xeon/contracts";
import type {
  HostedSearchError,
  HostedSearchModel,
  HostedSearchPort,
  HostedSearchRequest,
  HostedSearchResponse,
  HostedSearchSupport,
} from "@xeon/contracts/services";
import { Type } from "typebox";

// 시험용 `HostedSearchPort` 대역(L2.web.plan §2 `fixtures/tapes`). 모델 호출 없이 테이프에 적힌 응답을 순서대로 낸다.
// 테이프는 `ModelService.hostedSearch`가 돌려줄 값(포트 수준)이다. 모델 provider의 원시 스트림 테이프는 core-models가 시험한다.

const UsageSchema = Type.Object({
  inputTokens: Type.Integer({ minimum: 0 }),
  outputTokens: Type.Integer({ minimum: 0 }),
  searchRequests: Type.Integer({ minimum: 0 }),
});

const ResponseSchema = Type.Object({
  stopReason: Type.Union([
    Type.Literal("end_turn"),
    Type.Literal("pause_turn"),
    Type.Literal("max_tokens"),
    Type.Literal("refusal"),
  ]),
  text: Type.String(),
  results: Type.Array(
    Type.Object({
      url: Type.String(),
      title: Type.Union([Type.String(), Type.Null()]),
      pageAge: Type.Union([Type.String(), Type.Null()]),
    }),
  ),
  citations: Type.Array(
    Type.Object({
      url: Type.String(),
      title: Type.Union([Type.String(), Type.Null()]),
      citedText: Type.Union([Type.String(), Type.Null()]),
    }),
  ),
  usage: UsageSchema,
  model: Type.Object({ provider: Type.String(), modelId: Type.String() }),
  continuation: Type.Union([Type.String(), Type.Null()]),
});

const ErrorSchema = Type.Union([
  Type.Object({
    kind: Type.Literal("unsupported_model"),
    provider: Type.Union([Type.String(), Type.Null()]),
    modelId: Type.Union([Type.String(), Type.Null()]),
  }),
  Type.Object({ kind: Type.Literal("org_disabled") }),
  Type.Object({
    kind: Type.Literal("rate_limited"),
    retryAfterMs: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  }),
  Type.Object({
    kind: Type.Literal("upstream"),
    status: Type.Union([Type.Integer(), Type.Null()]),
    message: Type.String(),
  }),
  Type.Object({ kind: Type.Literal("cancelled") }),
]);

const TurnSchema = Type.Object({
  /** 이 차례의 요청이 싣고 와야 하는 continuation. 생략하면 검사하지 않는다 */
  expectContinuation: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  response: Type.Optional(ResponseSchema),
  error: Type.Optional(ErrorSchema),
});

const SupportSchema = Type.Union([
  Type.Object({
    supported: Type.Literal(true),
    provider: Type.String(),
    modelId: Type.String(),
  }),
  Type.Object({
    supported: Type.Literal(false),
    reason: Type.Union([Type.Literal("no_model"), Type.Literal("no_hosted_search")]),
  }),
]);

const HostedSearchTapeSchema = Type.Object({
  name: Type.String(),
  support: SupportSchema,
  turns: Type.Array(TurnSchema),
});
/** 테이프 한 차례. 응답이나 오류 중 하나를 낸다 */
interface HostedSearchTapeTurn {
  /** 이 차례의 요청이 싣고 와야 하는 continuation. 생략하면 검사하지 않는다 */
  readonly expectContinuation?: string | null;
  readonly response?: HostedSearchResponse;
  readonly error?: HostedSearchError;
}

export interface HostedSearchTape {
  readonly name: string;
  readonly support: HostedSearchSupport;
  readonly turns: readonly HostedSearchTapeTurn[];
}

export type HostedSearchTapeIssue =
  | { readonly kind: "not_json" }
  | { readonly kind: "invalid_shape" };

/** 테이프 JSON 텍스트를 읽는다. 시험 코드가 fixture 파일 내용을 넘긴다 */
export function readHostedSearchTape(
  text: string,
): Result<HostedSearchTape, HostedSearchTapeIssue> {
  const json = parseJson(text);
  if (!json.ok) return err({ kind: "not_json" });
  const tape = parse(HostedSearchTapeSchema, json.value);
  return tape.ok ? ok(tape.value) : err({ kind: "invalid_shape" });
}

export interface FakeHostedSearch extends HostedSearchPort {
  /** 받은 요청 기록 */
  readonly requests: HostedSearchRequest[];
  /** 모델 지원 여부를 바꾼다 */
  setSupport(next: HostedSearchSupport): void;
  /** `support` 호출에 받은 모델 */
  readonly supportQueries: HostedSearchModel[];
}

/** 테이프를 재생하는 포트. 테이프가 끝난 뒤의 요청과 `expectContinuation`이 어긋난 요청은 upstream 오류로 알린다 */
export function tapeHostedSearch(tape: HostedSearchTape): FakeHostedSearch {
  const requests: HostedSearchRequest[] = [];
  const supportQueries: HostedSearchModel[] = [];
  let support: HostedSearchSupport = tape.support;
  let position = 0;
  return {
    requests,
    supportQueries,
    setSupport(next) {
      support = next;
    },
    support(model) {
      supportQueries.push(model);
      return support;
    },
    search(request) {
      requests.push(request);
      const turn = tape.turns[position];
      position += 1;
      if (turn === undefined) {
        return Promise.resolve(
          err<HostedSearchError>({
            kind: "upstream",
            status: null,
            message: `tape ${tape.name} ran out at request ${String(position)}`,
          }),
        );
      }
      if (
        turn.expectContinuation !== undefined &&
        turn.expectContinuation !== request.continuation
      ) {
        return Promise.resolve(
          err<HostedSearchError>({
            kind: "upstream",
            status: null,
            message: `tape ${tape.name} expected continuation ${String(turn.expectContinuation)} at request ${String(position)}`,
          }),
        );
      }
      if (turn.error !== undefined) return Promise.resolve(err(turn.error));
      if (turn.response === undefined) {
        return Promise.resolve(
          err<HostedSearchError>({
            kind: "upstream",
            status: null,
            message: `tape ${tape.name} turn ${String(position)} has neither a response nor an error`,
          }),
        );
      }
      const response: HostedSearchResponse = turn.response;
      return Promise.resolve(ok(response));
    },
  };
}
