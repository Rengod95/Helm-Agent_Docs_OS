import { err, ok } from "@xeon/contracts";
import type { RedactionHit } from "@xeon/contracts/capabilities";
import type { Redactor } from "@xeon/contracts/services";

// Redactor 대역(L1.tools.plan 테스트 tool_result_masked_before_commit_and_points). 알려진 값을 [REDACTED:이름]으로 바꾼다.

function maskText(known: ReadonlyMap<string, string>, text: string) {
  const hits: RedactionHit[] = [];
  let out = text;
  for (const [name, value] of known) {
    const count = out.split(value).length - 1;
    if (count === 0) continue;
    out = out.replaceAll(value, `[REDACTED:${name}]`);
    hits.push({ kind: `known:${name}`, count });
  }
  return { text: out, hits };
}

function walk(known: ReadonlyMap<string, string>, value: unknown, hits: RedactionHit[]): unknown {
  if (typeof value === "string") {
    const masked = maskText(known, value);
    hits.push(...masked.hits);
    return masked.text;
  }
  if (Array.isArray(value)) {
    const items: readonly unknown[] = value;
    return items.map((item) => walk(known, item, hits));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, member]: [string, unknown]) => [
        key,
        walk(known, member, hits),
      ]),
    );
  }
  return value;
}

export function fakeRedactor(secrets: Readonly<Record<string, string>> = {}): Redactor {
  const known = new Map<string, string>(Object.entries(secrets));
  return {
    registerKnown(name, value) {
      if (value.length < 8) return err({ kind: "value_too_short", minBytes: 8 });
      known.set(name, new TextDecoder().decode(value));
      return ok(undefined);
    },
    forget: (name) => {
      known.delete(name);
    },
    mask: (text) => maskText(known, text),
    maskDeep<T>(value: T) {
      const hits: RedactionHit[] = [];
      const masked = walk(known, value, hits);
      // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion -- 허용 목록 A4 maskDeep: 구조를 유지한 채 문자열만 바꾼다 (eng.typescript.guide TY-06)
      return { value: masked as T, hits };
    },
    containsKnown: (text) => maskText(known, text).hits.length > 0,
  };
}
