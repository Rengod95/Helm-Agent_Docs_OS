/**
 * 능력 버전 범위 비교. F가 형식(isSemVerRange)만 검사하고 만족 계산은 X가 한다(F.capabilities.spec §4.1).
 * 허용 형식: `x.y.z`, `^x.y.z`, `~x.y.z`, `>=x.y.z`, `>=x.y.z <a.b.c`. 사전 릴리스 태그는 낮은 버전으로 본다
 */
type Triple = readonly [number, number, number];

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/;

function parseVersion(text: string): { readonly core: Triple; readonly pre: boolean } | undefined {
  const match = VERSION.exec(text);
  const major = match?.[1];
  const minor = match?.[2];
  const patch = match?.[3];
  if (major === undefined || minor === undefined || patch === undefined) return undefined;
  return { core: [Number(major), Number(minor), Number(patch)], pre: text.includes("-") };
}

function compare(a: Triple, b: Triple): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

function parseTriple(text: string): Triple | undefined {
  return parseVersion(text)?.core;
}

/** 범위 형식이 맞지 않으면 false다 */
export function satisfiesRange(version: string, range: string): boolean {
  const parsed = parseVersion(version);
  if (parsed === undefined) return false;
  const { core, pre } = parsed;
  const text = range.trim();

  const bounded = /^>=(\S+)\s+<(\S+)$/.exec(text);
  if (bounded?.[1] !== undefined && bounded[2] !== undefined) {
    const low = parseTriple(bounded[1]);
    const high = parseTriple(bounded[2]);
    if (low === undefined || high === undefined) return false;
    return !pre && compare(core, low) >= 0 && compare(core, high) < 0;
  }
  const lower = /^>=(\S+)$/.exec(text);
  if (lower?.[1] !== undefined) {
    const low = parseTriple(lower[1]);
    return low !== undefined && !pre && compare(core, low) >= 0;
  }
  const caret = /^\^(\S+)$/.exec(text);
  if (caret?.[1] !== undefined) {
    const base = parseTriple(caret[1]);
    if (base === undefined || pre) return false;
    // ^0.y.z는 y를, ^0.0.z는 z를 고정한다
    const upper: Triple =
      base[0] > 0 ? [base[0] + 1, 0, 0] : base[1] > 0 ? [0, base[1] + 1, 0] : [0, 0, base[2] + 1];
    return compare(core, base) >= 0 && compare(core, upper) < 0;
  }
  const tilde = /^~(\S+)$/.exec(text);
  if (tilde?.[1] !== undefined) {
    const base = parseTriple(tilde[1]);
    if (base === undefined || pre) return false;
    return compare(core, base) >= 0 && compare(core, [base[0], base[1] + 1, 0]) < 0;
  }
  const exact = parseVersion(text);
  return exact !== undefined && version === text;
}
