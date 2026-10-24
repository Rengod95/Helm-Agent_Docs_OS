import type { Static, TSchema } from "typebox";
import { Compile, type Validator } from "typebox/compile";
import { err, ok, type Result } from "./result.ts";

export type ParseIssue = {
  /** JSON Pointer (instancePath) */
  readonly path: string;
  /** JSON Schema 키워드 (required, pattern, maxLength, ...) */
  readonly keyword: string;
  readonly message: string;
};

export type ParseError = {
  readonly kind: "parse";
  /** 스키마의 $id. 없으면 undefined */
  readonly schemaId: string | undefined;
  /** 최대 20개 */
  readonly issues: readonly ParseIssue[];
};

const MAX_ISSUES = 20;

const validators = new WeakMap<TSchema, Validator>();

function validatorFor(schema: TSchema): Validator {
  const cached = validators.get(schema);
  if (cached !== undefined) return cached;
  const compiled = Compile(schema);
  validators.set(schema, compiled);
  return compiled;
}

/** 타입 술어: 검증기가 입력이 스키마의 정적 타입과 일치함을 확인한 경우에만 참이다. 단언을 쓰지 않는다. */
function matches<S extends TSchema>(schema: S, input: unknown): input is Static<S> {
  return validatorFor(schema).Check(input);
}

/**
 * 경계 입력(unknown)을 스키마로 검증해 도메인 타입으로 들인다(DT-05). 입력을 바꾸지 않고 던지지 않는다.
 * 검증기는 스키마 객체 단위로 캐시한다.
 */
export function parse<S extends TSchema>(schema: S, input: unknown): Result<Static<S>, ParseError> {
  if (matches(schema, input)) return ok(input);
  const validator = validatorFor(schema);
  const issues: ParseIssue[] = validator
    .Errors(input)
    .slice(0, MAX_ISSUES)
    .map((e) => ({ path: e.instancePath, keyword: e.keyword, message: e.message }));
  const rawId: unknown = Reflect.get(schema, "$id");
  const schemaId = typeof rawId === "string" ? rawId : undefined;
  return err({ kind: "parse", schemaId, issues });
}
