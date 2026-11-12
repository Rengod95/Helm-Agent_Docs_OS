import { describe, expect, test } from "bun:test";
import { encodeQr } from "../../src/qr/encode.ts";

// QR 인코더 시험(바이트 모드, 수준 M). 구조는 값으로 비교한다.
// 시험 쪽 표: ISO/IEC 18004 표 9(수준 M)의 코드워드 수·블록 수·EC, 정렬 패턴 좌표, 나머지 비트.
// 독립 검사: 형식·버전 정보는 긴 나눗셈으로 다시 계산하고, 데이터는 지그재그로 읽어 마스크를 풀고, 블록으로 나눠
// 블록마다 RS 신드롬이 0인지 확인한 뒤 모드·길이·글자를 복원한다. 채움 바이트 0xEC, 0x11도 본다.

type Matrix = boolean[][];

/** [심볼 코드워드, 블록당 EC, 블록 수] (버전 1~15, 수준 M) */
const M_TABLE: readonly (readonly [number, number, number])[] = [
  [26, 10, 1],
  [44, 16, 1],
  [70, 26, 1],
  [100, 18, 2],
  [134, 24, 2],
  [172, 16, 4],
  [196, 18, 4],
  [242, 22, 4],
  [292, 22, 5],
  [346, 26, 5],
  [404, 30, 5],
  [466, 22, 8],
  [532, 22, 9],
  [581, 24, 9],
  [655, 24, 10],
];

/** 나머지 비트 수(버전 1~15) */
const REMAINDER: readonly number[] = [0, 7, 7, 7, 7, 7, 0, 0, 0, 0, 0, 0, 0, 3, 3];

/** 정렬 패턴 중심 좌표(버전 1~15) */
const ALIGN: readonly (readonly number[])[] = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
  [6, 30, 54],
  [6, 32, 58],
  [6, 34, 62],
  [6, 26, 46, 66],
  [6, 26, 48, 70],
];

/** 수준 M 바이트 모드 용량(바이트). 버전 10부터 글자 수 지시자가 16비트다 */
const CAPACITY_M: readonly number[] = [
  14, 26, 42, 62, 84, 106, 122, 152, 180, 213, 251, 287, 331, 362, 412,
];

/** 수준 M의 형식 정보 15비트, 마스크 0~7 (ISO 18004 표 C.1) */
const FORMAT_M: readonly number[] = [
  "101010000010010",
  "101000100100101",
  "101111001111100",
  "101101101001011",
  "100010111111001",
  "100000011001110",
  "100111110010111",
  "100101010100000",
].map((bits) => parseInt(bits, 2));

/** 버전 정보 18비트(버전 7~10, ISO 18004 표 D.1) */
const VERSION_WORDS: readonly (readonly [number, number])[] = [
  [7, 0x07c94],
  [8, 0x085bc],
  [9, 0x09a99],
  [10, 0x0a4d3],
];

const MASK_HIT: readonly ((row: number, col: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 2)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

const FINDER7: number[][] = [
  [1, 1, 1, 1, 1, 1, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 0, 1, 1, 1, 0, 1],
  [1, 0, 1, 1, 1, 0, 1],
  [1, 0, 1, 1, 1, 0, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 1, 1, 1, 1, 1, 1],
];

const ALIGN5: number[][] = [
  [1, 1, 1, 1, 1],
  [1, 0, 0, 0, 1],
  [1, 0, 1, 0, 1],
  [1, 0, 0, 0, 1],
  [1, 1, 1, 1, 1],
];

/** 회귀 스냅샷: 입력 "A"의 모듈 격자(1은 검은 모듈). 구조 시험을 통과한 뒤에만 채운다 */
const SNAPSHOT_A: readonly string[] = [
  "111111101001001111111",
  "100000101111101000001",
  "101110100010101011101",
  "101110101101101011101",
  "101110100111001011101",
  "100000100101101000001",
  "111111101010101111111",
  "000000001101100000000",
  "101101110011101001011",
  "010110010101111001000",
  "110011101101000001101",
  "101101000001001111100",
  "100111100100100100100",
  "000000001011001001001",
  "111111101001100101000",
  "100000101100000110110",
  "101110100110111110001",
  "101110101111001111110",
  "101110101010101100000",
  "100000100010010100101",
  "111111101000010010000",
];

function pick<T>(list: readonly T[], index: number): T {
  const value = list[index];
  if (value === undefined) throw new Error(`index ${index} out of range`);
  return value;
}

function cellBit(m: Matrix, row: number, col: number): number {
  return pick(pick(m, row), col) ? 1 : 0;
}

function regionBits(
  m: Matrix,
  top: number,
  left: number,
  height: number,
  width: number,
): number[][] {
  return Array.from({ length: height }, (_, dr) =>
    Array.from({ length: width }, (_c, dc) => cellBit(m, top + dr, left + dc)),
  );
}

function rowsOf(m: Matrix): string[] {
  return m.map((row) => row.map((v) => (v ? "1" : "0")).join(""));
}

/** ISO 18004 모듈 수 식: 한 변이 (16v+128)v+64에서 정렬·버전 정보 자리를 뺀 것 */
function rawModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    result -= (25 * align - 10) * align - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

/** 긴 나눗셈: value · x^degree 를 generator로 나눈 나머지 */
function polyRemainder(value: number, generator: number, degree: number): number {
  let v = value << degree;
  const top = value.toString(2).length - 1 + degree;
  for (let bit = top; bit >= degree; bit--) {
    if (((v >> bit) & 1) === 1) v ^= generator << (bit - degree);
  }
  return v;
}

/** 형식 정보 15비트: 데이터 5비트 뒤에 BCH(15,5) 나머지를 붙이고 마스크 0x5412를 씌운다 */
function formatWordOf(data: number): number {
  return ((data << 10) | polyRemainder(data, 0x537, 10)) ^ 0x5412;
}

/** 버전 정보 18비트: 버전 6비트 뒤에 BCH(18,6) 나머지 */
function versionWordOf(version: number): number {
  return (version << 12) | polyRemainder(version, 0x1f25, 12);
}

/** 형식 정보 첫 복사의 자리: 비트 i의 [행, 열] (ISO 18004 그림 25) */
function formatCopyA(): [number, number][] {
  const cells: [number, number][] = [];
  for (let i = 0; i <= 5; i++) cells.push([i, 8]);
  cells.push([7, 8], [8, 8], [8, 7]);
  for (let i = 9; i <= 14; i++) cells.push([8, 14 - i]);
  return cells;
}

/** 형식 정보 두 번째 복사의 자리 */
function formatCopyB(size: number): [number, number][] {
  const cells: [number, number][] = [];
  for (let i = 0; i <= 7; i++) cells.push([8, size - 1 - i]);
  for (let i = 8; i <= 14; i++) cells.push([size - 15 + i, 8]);
  return cells;
}

function bitsToNumber(bits: readonly number[]): number {
  let value = 0;
  for (const bit of bits) value = (value << 1) | bit;
  return value;
}

function readWord(m: Matrix, cells: readonly (readonly [number, number])[]): number {
  return bitsToNumber(cells.map(([r, c]) => cellBit(m, r, c)).toReversed());
}

/** 형식 정보 두 복사를 읽고, 첫 복사를 BCH로 풀어 데이터(수준 2비트 + 마스크 3비트)를 찾는다 */
function formatOf(m: Matrix): {
  readonly copies: readonly [number, number];
  readonly data: number;
} {
  const copyA = readWord(m, formatCopyA());
  const copyB = readWord(m, formatCopyB(m.length));
  const data = Array.from({ length: 32 }, (_, d) => d).find((d) => formatWordOf(d) === copyA);
  if (data === undefined) throw new Error("format copy A is not a valid BCH word");
  return { copies: [copyA, copyB], data };
}

/** 버전 정보 두 복사(버전 7 이상): 오른쪽 위 블록과 왼쪽 아래 블록 */
function versionCopies(m: Matrix): [number, number] {
  const size = m.length;
  const topRight: [number, number][] = [];
  const bottomLeft: [number, number][] = [];
  for (let i = 0; i < 18; i++) {
    const a = size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    topRight.push([b, a]);
    bottomLeft.push([a, b]);
  }
  return [readWord(m, topRight), readWord(m, bottomLeft)];
}

function alignCentersOf(version: number): [number, number][] {
  const list = pick(ALIGN, version - 1);
  const first = list[0];
  const last = list.at(-1);
  const centers: [number, number][] = [];
  for (const row of list) {
    for (const col of list) {
      if (row === first && (col === first || col === last)) continue;
      if (row === last && col === first) continue;
      centers.push([row, col]);
    }
  }
  return centers;
}

/** 기능 패턴(찾기, 분리, 타이밍, 정렬, 형식, 버전, 어두운 모듈)인지 */
function isFunction(row: number, col: number, size: number, version: number): boolean {
  if (row === 6 || col === 6) return true;
  if (row <= 8 && col <= 8) return true;
  if (row <= 8 && col >= size - 8) return true;
  if (row >= size - 8 && col <= 8) return true;
  if (version >= 7) {
    if (row <= 5 && col >= size - 11 && col <= size - 9) return true;
    if (col <= 5 && row >= size - 11 && row <= size - 9) return true;
  }
  return alignCentersOf(version).some(
    ([cr, cc]) => Math.abs(row - cr) <= 2 && Math.abs(col - cc) <= 2,
  );
}

/** 데이터 모듈 놓는 순서: 열을 오른쪽 끝부터 모으고(열 6 제외), 두 열씩 짝 지어 위·아래 번갈아 훑는다 */
function dataOrder(size: number, version: number): [number, number][] {
  const columns: number[] = [];
  for (let c = size - 1; c >= 0; c--) if (c !== 6) columns.push(c);
  const order: [number, number][] = [];
  for (let k = 0; k < columns.length; k += 2) {
    const upward = (k / 2) % 2 === 0;
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (const col of [pick(columns, k), pick(columns, k + 1)]) {
        if (!isFunction(row, col, size, version)) order.push([row, col]);
      }
    }
  }
  return order;
}

/** 블록 구성(짧은 블록을 먼저)과 블록당 EC 수 */
function blockLayout(version: number): { readonly dataLengths: number[]; readonly ec: number } {
  const [total, ec, blocks] = pick(M_TABLE, version - 1);
  const shortTotal = Math.floor(total / blocks);
  const shortCount = blocks - (total % blocks);
  const dataLengths = Array.from(
    { length: blocks },
    (_, b) => (b < shortCount ? shortTotal : shortTotal + 1) - ec,
  );
  return { dataLengths, ec };
}

/** 인터리브된 코드워드를 블록별 데이터와 EC로 되돌린다 */
function deinterleave(
  words: readonly number[],
  version: number,
): { readonly data: number[][]; readonly parity: number[][] } {
  const { dataLengths, ec } = blockLayout(version);
  const data: number[][] = dataLengths.map(() => []);
  const parity: number[][] = dataLengths.map(() => []);
  let p = 0;
  const longest = Math.max(...dataLengths);
  for (let i = 0; i < longest; i++) {
    for (let b = 0; b < dataLengths.length; b++) {
      if (i < pick(dataLengths, b)) {
        pick(data, b).push(pick(words, p));
        p++;
      }
    }
  }
  for (let i = 0; i < ec; i++) {
    for (let b = 0; b < dataLengths.length; b++) {
      pick(parity, b).push(pick(words, p));
      p++;
    }
  }
  return { data, parity };
}

/** GF(256), 0x11D: 시험 쪽 독립 구현 */
const GF_EXP: number[] = [];
const GF_LOG: number[] = Array.from({ length: 256 }, () => 0);
(() => {
  let value = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP.push(value);
    GF_LOG[value] = i;
    value <<= 1;
    if ((value & 0x100) !== 0) value ^= 0x11d;
  }
})();

function gfMulTest(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return pick(GF_EXP, (pick(GF_LOG, a) + pick(GF_LOG, b)) % 255);
}

/** 코드워드 전체(데이터 + EC)를 α^0 … α^(ec-1)에서 대입한다. 모두 0이어야 RS 코드워드다. [i, 값] 목록 */
function nonZeroSyndromes(codeword: readonly number[], ec: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < ec; i++) {
    const root = pick(GF_EXP, i);
    let s = 0;
    for (const byte of codeword) s = gfMulTest(s, root) ^ byte;
    if (s !== 0) out.push([i, s]);
  }
  return out;
}

function bytesOfBits(bits: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(bitsToNumber(bits.slice(i, i + 8)));
  return out;
}

function bitsOfBytes(bytes: readonly number[]): number[] {
  const out: number[] = [];
  for (const byte of bytes) for (let i = 7; i >= 0; i--) out.push((byte >> i) & 1);
  return out;
}

interface ReadSymbol {
  readonly version: number;
  readonly mask: number;
  readonly blocks: readonly { readonly data: number[]; readonly parity: number[] }[];
  /** 데이터 모듈 중 코드워드에 쓰지 않은 개수(나머지 비트) */
  readonly extraModules: number;
}

/** 심볼을 거꾸로 읽는다: 형식으로 마스크를 알고, 지그재그로 비트를 모아 마스크를 풀고, 블록으로 나눈다 */
function readSymbol(m: Matrix): ReadSymbol {
  const size = m.length;
  const version = (size - 17) / 4;
  const mask = formatOf(m).data & 7;
  const bits = dataOrder(size, version).map(
    ([row, col]) => cellBit(m, row, col) ^ (pick(MASK_HIT, mask)(row, col) ? 1 : 0),
  );
  const [total] = pick(M_TABLE, version - 1);
  const codewords = bytesOfBits(bits.slice(0, total * 8));
  const { data, parity } = deinterleave(codewords, version);
  return {
    version,
    mask,
    blocks: data.map((d, b) => ({ data: d, parity: pick(parity, b) })),
    extraModules: bits.length - total * 8,
  };
}

interface ParsedData {
  readonly mode: number;
  readonly count: number;
  readonly text: string;
  /** 종결자와 바이트 맞춤 자리의 비트 */
  readonly gap: number[];
  /** 채움 바이트 */
  readonly pads: number[];
}

function parseDataWords(dataWords: readonly number[], version: number): ParsedData {
  const bits = bitsOfBytes(dataWords);
  const countWidth = version <= 9 ? 8 : 16;
  const mode = bitsToNumber(bits.slice(0, 4));
  const count = bitsToNumber(bits.slice(4, 4 + countWidth));
  const start = 4 + countWidth;
  const end = start + count * 8;
  const text = new TextDecoder().decode(new Uint8Array(bytesOfBits(bits.slice(start, end))));
  const padStart = Math.ceil(Math.min(end + 4, dataWords.length * 8) / 8);
  return {
    mode,
    count,
    text,
    gap: bits.slice(end, padStart * 8),
    pads: dataWords.slice(padStart),
  };
}

function matrixOf(text: string): Matrix {
  const result = encodeQr(text);
  if (!result.ok) throw new Error(`encode failed: ${result.error.kind}`);
  return result.value;
}

/** ASCII 글자 length개 */
function sample(length: number): string {
  return Array.from({ length }, (_, i) => String.fromCharCode(65 + (i % 26))).join("");
}

/** 되읽기 한 번으로 버전, RS 신드롬(블록별), 모드, 길이, 글자, 종결자·채움을 모두 확인한다 */
function verifyRoundTrip(text: string, expectedVersion: number): void {
  const read = readSymbol(matrixOf(text));
  expect(read.version).toBe(expectedVersion);
  const badSyndromes = read.blocks.flatMap((block, index) =>
    nonZeroSyndromes([...block.data, ...block.parity], block.parity.length).map(([i, s]) => [
      index,
      i,
      s,
    ]),
  );
  expect(badSyndromes).toEqual([]);
  const dataWords = read.blocks.flatMap((block) => block.data);
  const parsed = parseDataWords(dataWords, read.version);
  expect(parsed.mode).toBe(0b0100);
  expect(parsed.count).toBe(new TextEncoder().encode(text).length);
  expect(parsed.text).toBe(text);
  expect(parsed.gap).toEqual(Array.from({ length: parsed.gap.length }, () => 0));
  expect(parsed.pads).toEqual(
    Array.from({ length: parsed.pads.length }, (_, i) => (i % 2 === 0 ? 0xec : 0x11)),
  );
}

describe("표와 모듈 수", () => {
  test("total codewords and remainder bits agree with the raw module count, v1..15", () => {
    for (let v = 1; v <= 15; v++) {
      const [total] = pick(M_TABLE, v - 1);
      expect([v, Math.floor(rawModules(v) / 8), rawModules(v) % 8]).toEqual([
        v,
        total,
        pick(REMAINDER, v - 1),
      ]);
    }
  });

  test("byte capacity at level M, v1..15 (16-bit count from v10)", () => {
    const capacities = Array.from({ length: 15 }, (_, i) => {
      const v = i + 1;
      const [total, ec, blocks] = pick(M_TABLE, v - 1);
      const dataBits = (total - ec * blocks) * 8;
      const countWidth = v <= 9 ? 8 : 16;
      return Math.floor((dataBits - 4 - countWidth) / 8);
    });
    expect(capacities).toEqual([...CAPACITY_M]);
  });

  test("block layout: data codewords per version", () => {
    const dataPerVersion = Array.from({ length: 15 }, (_, i) =>
      blockLayout(i + 1).dataLengths.reduce((sum, n) => sum + n, 0),
    );
    expect(dataPerVersion).toEqual([
      16, 28, 44, 64, 86, 108, 124, 154, 182, 216, 254, 290, 334, 365, 415,
    ]);
  });
});

describe("기능 패턴", () => {
  test("finder patterns at three corners are the exact 7x7 pattern; separators are light", () => {
    const m = matrixOf("A");
    const size = m.length;
    expect(size).toBe(21);
    expect(regionBits(m, 0, 0, 7, 7)).toEqual([...FINDER7]);
    expect(regionBits(m, 0, size - 7, 7, 7)).toEqual([...FINDER7]);
    expect(regionBits(m, size - 7, 0, 7, 7)).toEqual([...FINDER7]);
    // 분리 띠: 가로는 행 7과 size-8, 세로는 열 7과 size-8 (흰색)
    expect(regionBits(m, 7, 0, 1, 8)).toEqual([[0, 0, 0, 0, 0, 0, 0, 0]]);
    expect(regionBits(m, 7, size - 8, 1, 8)).toEqual([[0, 0, 0, 0, 0, 0, 0, 0]]);
    expect(regionBits(m, size - 8, 0, 1, 8)).toEqual([[0, 0, 0, 0, 0, 0, 0, 0]]);
    expect(regionBits(m, 0, 7, 8, 1)).toEqual(Array.from({ length: 8 }, () => [0]));
    expect(regionBits(m, 0, size - 8, 8, 1)).toEqual(Array.from({ length: 8 }, () => [0]));
    expect(regionBits(m, size - 8, 7, 8, 1)).toEqual(Array.from({ length: 8 }, () => [0]));
  });

  test("timing row 6 and column 6 alternate from the finder edge", () => {
    for (const text of ["A", sample(130)]) {
      const m = matrixOf(text);
      const size = m.length;
      const expected = Array.from({ length: size - 16 }, (_, i) => ((i + 8) % 2 === 0 ? 1 : 0));
      const row6 = Array.from({ length: size }, (_, c) => cellBit(m, 6, c));
      const col6 = Array.from({ length: size }, (_, r) => cellBit(m, r, 6));
      expect(row6.slice(8, size - 8)).toEqual(expected);
      expect(col6.slice(8, size - 8)).toEqual(expected);
    }
  });

  test("dark module at (4v+9, 8) is dark for every version", () => {
    for (let v = 1; v <= 15; v++) {
      const m = matrixOf(sample(pick(CAPACITY_M, v - 1)));
      expect(m.length).toBe(17 + 4 * v);
      expect(cellBit(m, 4 * v + 9, 8)).toBe(1);
    }
  });

  test("alignment patterns of v7 are the 5x5 ring at each listed center", () => {
    const m = matrixOf(sample(pick(CAPACITY_M, 6)));
    expect(m.length).toBe(45);
    expect(alignCentersOf(7)).toEqual([
      [6, 22],
      [22, 6],
      [22, 22],
      [22, 38],
      [38, 22],
      [38, 38],
    ]);
    for (const [r, c] of alignCentersOf(7)) {
      expect(regionBits(m, r - 2, c - 2, 5, 5)).toEqual(ALIGN5);
    }
  });

  test("data modules = 8 x codewords + remainder bits, v1..15", () => {
    for (let v = 1; v <= 15; v++) {
      const size = 17 + 4 * v;
      const [total] = pick(M_TABLE, v - 1);
      expect([v, dataOrder(size, v).length]).toEqual([v, total * 8 + pick(REMAINDER, v - 1)]);
    }
  });
});

describe("형식과 버전 정보", () => {
  test("format info: BCH words equal the table; both copies match and decode to level M", () => {
    expect(Array.from({ length: 8 }, (_, mask) => formatWordOf(mask))).toEqual([...FORMAT_M]);
    for (const text of ["A", sample(20), sample(130), sample(200)]) {
      const m = matrixOf(text);
      const { copies, data } = formatOf(m);
      expect(copies[0]).toBe(copies[1]);
      expect(data >> 3).toBe(0); // 수준 M = 00
      expect(copies[0]).toBe(pick(FORMAT_M, data & 7));
    }
  });

  test("version info (v7 and up): both copies equal the BCH(18,6) word", () => {
    for (const [v, word] of VERSION_WORDS) {
      expect(versionWordOf(v)).toBe(word);
      expect(versionCopies(matrixOf(sample(pick(CAPACITY_M, v - 1))))).toEqual([word, word]);
    }
    for (let v = 7; v <= 15; v++) {
      const m = matrixOf(sample(pick(CAPACITY_M, v - 1)));
      expect(versionCopies(m)).toEqual([versionWordOf(v), versionWordOf(v)]);
    }
  });
});

describe("데이터 되읽기: RS, 블록 나눔, 채움", () => {
  test('"A" (v1): one block, no remainder bits', () => {
    verifyRoundTrip("A", 1);
    const read = readSymbol(matrixOf("A"));
    expect(read.blocks.map((b) => b.data.length)).toEqual([16]);
    expect(read.blocks.map((b) => b.parity.length)).toEqual([10]);
    expect(read.extraModules).toBe(0);
  });

  test("a 20-char string picks v2", () => {
    verifyRoundTrip("Fresnel QR round trip 01", 2);
  });

  test("a 130-char URL picks v8 (123..152 bytes)", () => {
    const url = `https://example.com/#code=${"x".repeat(104)}`;
    expect(url.length).toBe(130);
    verifyRoundTrip(url, 8);
  });

  test("a 200-char string picks v10 (16-bit count)", () => {
    verifyRoundTrip(sample(200), 10);
  });

  test("Hangul counts UTF-8 bytes: five syllables are 15 bytes and pick v2", () => {
    verifyRoundTrip("가나다라마", 2);
  });

  test("exact boundaries: 14 → v1, 15 → v2, 122 → v7, 123 → v8, 152 → v8, 153 → v9", () => {
    expect(
      [14, 15, 122, 123, 152, 153].map((n) => readSymbol(matrixOf(sample(n))).version),
    ).toEqual([1, 2, 7, 8, 8, 9]);
  });

  test("every version at full capacity (v1..15) and one byte over it picks the next", () => {
    for (let v = 1; v <= 15; v++) {
      verifyRoundTrip(sample(pick(CAPACITY_M, v - 1)), v);
      if (v < 15) verifyRoundTrip(sample(pick(CAPACITY_M, v - 1) + 1), v + 1);
    }
  });

  test("413 bytes is too long; 412 bytes still fits v15", () => {
    expect(encodeQr(sample(413))).toEqual({ ok: false, error: { kind: "too_long" } });
    verifyRoundTrip(sample(412), 15);
  });

  test("the RS check catches a single flipped codeword byte (checker sanity)", () => {
    const [block] = readSymbol(matrixOf("A")).blocks;
    if (block === undefined) throw new Error("no block");
    const corrupted = [...block.data, ...block.parity];
    corrupted[3] = pick(corrupted, 3) ^ 0x10;
    expect(nonZeroSyndromes(corrupted, block.parity.length).length).toBeGreaterThan(0);
  });
});

describe("회귀 스냅샷", () => {
  test('"A" matrix matches the structurally validated snapshot', () => {
    expect(rowsOf(matrixOf("A"))).toEqual([...SNAPSHOT_A]);
  });
});
