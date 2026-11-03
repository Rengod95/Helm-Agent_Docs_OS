import { parsePointer, readPointer, type PointerRead } from "./pointer.ts";

// 식이 경로를 읽는 범위. doc은 화면이 받은 데이터, locals는 each가 만든 이름(each.as)과 그 값이다.

export interface Scope {
  readonly doc: unknown;
  readonly locals: ReadonlyMap<string, unknown>;
}

export function createScope(doc: unknown): Scope {
  return { doc, locals: new Map<string, unknown>() };
}

/** 이름 하나를 더한 새 범위를 돌려준다. 원래 범위는 바뀌지 않는다 */
export function withLocal(scope: Scope, name: string, value: unknown): Scope {
  const locals = new Map<string, unknown>(scope.locals);
  locals.set(name, value);
  return { doc: scope.doc, locals };
}

/**
 * 경로의 첫 세그먼트가 지역 이름이면 그 값부터 읽고, 아니면 doc에서 읽는다.
 * 지역 이름이 doc의 같은 키보다 우선한다. 형식이 틀린 경로는 찾지 못한 것이다.
 */
export function resolvePath(scope: Scope, pointer: string): PointerRead {
  const segments = parsePointer(pointer);
  if (segments === undefined) return { found: false };
  const [head, ...rest] = segments;
  if (head !== undefined && scope.locals.has(head)) {
    return readPointer(scope.locals.get(head), rest);
  }
  return readPointer(scope.doc, segments);
}
