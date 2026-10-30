import { err, ok, type Result } from "@xeon/contracts";
import type { McpQuestion } from "@xeon/contracts/capabilities";
import type { JsonObject, JsonValue } from "@xeon/contracts/conversation";
import { asJsonObject, stringOf } from "../json.ts";

// L2.mcp.spec §4.6 1번, 10번과 §4.7. `input_required` 결과의 입력 요청을 사람에게 묻는 질문으로 바꾼다.
// elicitation(form, url)만 선언했으므로 선언하지 않은 종류(sampling, roots)가 오면 `input_unsupported`다.
// sampling은 지원하지 않는다(MCP 2026-07-28 Deprecated, M3-REQ-97). 서버가 보내면 거부 오류로 답한다.

/** 폼 필드 이름이 비밀처럼 보일 때 질문 앞에 붙이는 경고(사양: 비밀은 form 모드로 받지 않는다) */
export const SECRET_FIELD_WARNING = "[주의] 이 양식에 비밀번호, 키, 토큰을 입력하지 마십시오.";

const SECRET_NAME =
  /pass(word)?|passwd|token|secret|api[-_ ]?key|credential|private[-_ ]?key|cvv|card[-_ ]?number/i;

export type QuestionError = {
  readonly code: "input_unsupported";
  readonly kind: string;
  readonly message: string;
};

function propertyNames(schema: JsonValue | undefined): readonly string[] {
  const object = asJsonObject(schema);
  const properties = asJsonObject(object?.["properties"]);
  return properties === undefined ? [] : Object.keys(properties);
}

function hasSecretLikeField(schema: JsonValue | undefined): boolean {
  return propertyNames(schema).some((name) => SECRET_NAME.test(name));
}

function questionOf(
  server: string,
  key: string,
  request: JsonObject,
): Result<McpQuestion, QuestionError> {
  const method = stringOf(request["method"]);
  const params = asJsonObject(request["params"]) ?? {};
  if (method === "elicitation/create") {
    const message = stringOf(params["message"]) ?? "";
    if (stringOf(params["mode"]) === "url") {
      const url = stringOf(params["url"]);
      if (url === undefined) {
        return err({
          code: "input_unsupported",
          kind: "elicitation_url",
          message: "url mode needs a url",
        });
      }
      return ok({ key, kind: "elicitation_url", server, message, url });
    }
    const requestedSchema = params["requestedSchema"] ?? null;
    const warned = hasSecretLikeField(requestedSchema);
    return ok({
      key,
      kind: "elicitation_form",
      server,
      message: warned ? `${SECRET_FIELD_WARNING}\n${message}` : message,
      requestedSchema,
    });
  }
  return err({
    code: "input_unsupported",
    kind: method ?? "unknown",
    message: `the server asked for an input kind that was not declared: ${method ?? "unknown"}`,
  });
}

/** 입력 요청 전체를 질문으로 바꾼다. 하나라도 지원하지 않는 종류면 전체가 실패한다 */
export function buildQuestions(
  server: string,
  inputRequests: JsonObject,
): Result<McpQuestion[], QuestionError> {
  const questions: McpQuestion[] = [];
  for (const [key, value] of Object.entries(inputRequests)) {
    const request = asJsonObject(value);
    if (request === undefined) {
      return err({
        code: "input_unsupported",
        kind: "unknown",
        message: `input request ${key} is not an object`,
      });
    }
    const question = questionOf(server, key, request);
    if (!question.ok) return question;
    questions.push(question.value);
  }
  return ok(questions);
}
