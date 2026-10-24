import { Bug } from "@xeon/contracts";

export type VersionTriple = readonly [number, number, number];

const VERSION_IN_TEXT = /(\d+)\.(\d+)(?:\.(\d+))?/;
const STRICT_VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

function toTriple(major: string, minor: string, patch: string | undefined): VersionTriple {
  return [Number(major), Number(minor), Number(patch ?? "0")];
}

/** 출력 한 덩이에서 처음 나오는 `X.Y` 또는 `X.Y.Z`를 `X.Y.Z` 문자열로 돌려준다. 없으면 undefined */
export function findVersion(text: string): string | undefined {
  const match = VERSION_IN_TEXT.exec(text);
  if (match === null) return undefined;
  const [major, minor, patch] = toTriple(match[1] ?? "0", match[2] ?? "0", match[3]);
  return `${major}.${minor}.${patch}`;
}

/** `X.Y.Z` 문자열을 숫자 셋으로 바꾼다. 형식이 틀리면 undefined */
export function parseTriple(version: string): VersionTriple | undefined {
  const match = STRICT_VERSION.exec(version);
  if (match === null) return undefined;
  return toTriple(match[1] ?? "0", match[2] ?? "0", match[3]);
}

/** 앞이 크면 양수, 같으면 0, 작으면 음수 */
export function compareTriples(a: VersionTriple, b: VersionTriple): number {
  for (let i = 0; i < 3; i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** 호출자가 준 minVersion이 `X.Y.Z`가 아니면 호출 쪽 버그다 */
export function requireTriple(version: string): VersionTriple {
  const triple = parseTriple(version);
  if (triple === undefined) throw new Bug(`minVersion must look like X.Y.Z: ${version}`);
  return triple;
}
