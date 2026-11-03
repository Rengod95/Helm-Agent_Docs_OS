// RFC 6901 JSON Pointer 파싱과 읽기. 문서 안의 own 속성과 배열 원소만 읽는다.
// 프로토타입에서 오는 이름("__proto__", "constructor", "prototype")은 own 속성이 있어도 찾지 못한 것으로 본다.

/** 경로 읽기 결과. 찾으면 값을 담고, 못 찾으면 이유 없이 `found: false`다 */
export type PointerRead =
  | { readonly found: true; readonly value: unknown }
  | { readonly found: false };

const FORBIDDEN_SEGMENTS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);
const CANONICAL_INDEX = /^(?:0|[1-9][0-9]*)$/;
const BAD_TILDE = /~(?![01])/;

/** "" → [], "/a/b" → ["a", "b"]. `~1`은 "/", `~0`은 "~"다. 형식이 틀리면 undefined */
export function parsePointer(pointer: string): readonly string[] | undefined {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) return undefined;
  const segments: string[] = [];
  for (const raw of pointer.slice(1).split("/")) {
    if (BAD_TILDE.test(raw)) return undefined;
    segments.push(raw.replaceAll("~1", "/").replaceAll("~0", "~"));
  }
  return segments;
}

/** 세그먼트 하나를 JSON Pointer 조각으로 적는다. 진단 경로를 만들 때 쓴다 */
export function escapePointerSegment(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

/** 세그먼트를 차례로 따라 값을 읽는다. 배열 index는 정규 10진 수이고 범위 안이어야 한다 */
export function readPointer(doc: unknown, segments: readonly string[]): PointerRead {
  let current: unknown = doc;
  for (const segment of segments) {
    const step = readSegment(current, segment);
    if (!step.found) return { found: false };
    current = step.value;
  }
  return { found: true, value: current };
}

function readSegment(container: unknown, segment: string): PointerRead {
  if (FORBIDDEN_SEGMENTS.has(segment)) return { found: false };
  if (isArrayValue(container)) {
    if (!CANONICAL_INDEX.test(segment)) return { found: false };
    const index = Number(segment);
    if (index >= container.length) return { found: false };
    return { found: true, value: container[index] };
  }
  if (isRecordValue(container) && Object.hasOwn(container, segment)) {
    return { found: true, value: container[segment] };
  }
  return { found: false };
}

function isArrayValue(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function isRecordValue(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
