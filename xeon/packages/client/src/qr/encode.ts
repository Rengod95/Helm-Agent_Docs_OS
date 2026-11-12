import { Bug, err, ok, type Result } from "@fresnel/contracts";

// QR 코드(ISO/IEC 18004, 모델 2) 인코더. 바이트 모드, 오류 정정 M, 버전 1~15, 마스크 0~7 중 감점이 가장 낮은 것.
// 순수 함수만 있어 어느 번들에든 들어갈 수 있다. 표는 ISO 18004 표 9(수준 M)에서 왔고, 시험이 구조를 값으로 확인한다.

export type QrEncodeError = { readonly kind: "too_long" };

/** 버전 하나의 수준 M 표. align은 정렬 패턴 중심 좌표(행과 열에 같이 쓴다) */
interface VersionSpec {
  /** 코드워드 수(데이터 + 오류 정정) */
  readonly total: number;
  /** 블록 하나의 오류 정정 코드워드 수 */
  readonly ecPerBlock: number;
  readonly blocks: number;
  readonly align: readonly number[];
}

const VERSIONS: readonly VersionSpec[] = [
  { total: 26, ecPerBlock: 10, blocks: 1, align: [] },
  { total: 44, ecPerBlock: 16, blocks: 1, align: [6, 18] },
  { total: 70, ecPerBlock: 26, blocks: 1, align: [6, 22] },
  { total: 100, ecPerBlock: 18, blocks: 2, align: [6, 26] },
  { total: 134, ecPerBlock: 24, blocks: 2, align: [6, 30] },
  { total: 172, ecPerBlock: 16, blocks: 4, align: [6, 34] },
  { total: 196, ecPerBlock: 18, blocks: 4, align: [6, 22, 38] },
  { total: 242, ecPerBlock: 22, blocks: 4, align: [6, 24, 42] },
  { total: 292, ecPerBlock: 22, blocks: 5, align: [6, 26, 46] },
  { total: 346, ecPerBlock: 26, blocks: 5, align: [6, 28, 50] },
  { total: 404, ecPerBlock: 30, blocks: 5, align: [6, 30, 54] },
  { total: 466, ecPerBlock: 22, blocks: 8, align: [6, 32, 58] },
  { total: 532, ecPerBlock: 22, blocks: 9, align: [6, 34, 62] },
  { total: 581, ecPerBlock: 24, blocks: 9, align: [6, 26, 46, 66] },
  { total: 655, ecPerBlock: 24, blocks: 10, align: [6, 26, 48, 70] },
];

/** 행마다 열 배열. true가 검은 모듈 */
type Grid = boolean[][];

interface Canvas {
  readonly modules: Grid;
  /** 기능 패턴과 형식·버전 정보 자리. 데이터와 마스크는 여기를 건드리지 않는다 */
  readonly reserved: Grid;
}

/** [행, 열] */
type Cell = readonly [row: number, col: number];

/** 범위 밖 인덱스는 표나 격자를 잘못 다룬 것이므로 버그다 */
function pick<T>(list: readonly T[], index: number): T {
  const value = list[index];
  if (value === undefined) throw new Bug(`index ${index} is outside its table`);
  return value;
}

function cellAt(grid: Grid, row: number, col: number): boolean {
  return pick(pick(grid, row), col);
}

interface GaloisField {
  readonly exp: readonly number[];
  readonly log: readonly number[];
}

/** GF(256), 원시 다항식 0x11D, 생성원 2 */
function buildGaloisField(): GaloisField {
  const exp: number[] = [];
  const log: number[] = Array.from({ length: 256 }, () => 0);
  let value = 1;
  for (let i = 0; i < 255; i++) {
    exp.push(value);
    log[value] = i;
    value <<= 1;
    if ((value & 0x100) !== 0) value ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) exp.push(pick(exp, i - 255));
  return { exp, log };
}

const GF: GaloisField = buildGaloisField();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return pick(GF.exp, pick(GF.log, a) + pick(GF.log, b));
}

/** 생성 다항식 ∏(x - α^i), i < degree에서 최고차 1을 뺀 계수(최고차부터) */
function rsDivisor(degree: number): number[] {
  let poly: number[] = [1]; // poly[k]는 x^k의 계수
  for (let i = 0; i < degree; i++) {
    const root = pick(GF.exp, i);
    const next: number[] = [];
    for (let k = 0; k <= poly.length; k++) {
      const shifted = k >= 1 ? pick(poly, k - 1) : 0;
      const scaled = k < poly.length ? gfMul(root, pick(poly, k)) : 0;
      next.push(shifted ^ scaled);
    }
    poly = next;
  }
  return poly.slice(0, degree).toReversed();
}

/** 데이터 블록 하나에 대한 오류 정정 코드워드 */
function rsRemainder(data: readonly number[], degree: number): number[] {
  const divisor = rsDivisor(degree);
  const rem: number[] = Array.from({ length: degree }, () => 0);
  for (const byte of data) {
    const factor = byte ^ pick(rem, 0);
    rem.shift();
    rem.push(0);
    for (let i = 0; i < degree; i++) rem[i] = pick(rem, i) ^ gfMul(pick(divisor, i), factor);
  }
  return rem;
}

function countBits(version: number): number {
  return version <= 9 ? 8 : 16;
}

/** 데이터 코드워드 수(심볼 전체에서 오류 정정을 뺀 것) */
function dataCodewordCount(version: number): number {
  const spec = pick(VERSIONS, version - 1);
  return spec.total - spec.ecPerBlock * spec.blocks;
}

function byteCapacity(version: number): number {
  return Math.floor((dataCodewordCount(version) * 8 - 4 - countBits(version)) / 8);
}

function versionFor(byteLength: number): number | undefined {
  for (let version = 1; version <= VERSIONS.length; version++) {
    if (byteLength <= byteCapacity(version)) return version;
  }
  return undefined;
}

function pushBits(bits: number[], value: number, count: number): void {
  for (let i = count - 1; i >= 0; i--) bits.push((value >> i) & 1);
}

/** 모드 지시자, 글자 수, 바이트, 종결자, 바이트 맞춤, 채움 바이트(0xEC, 0x11 번갈아)로 데이터 코드워드를 만든다 */
function dataCodewords(bytes: Uint8Array, version: number): number[] {
  const capacity = dataCodewordCount(version);
  const bits: number[] = [];
  pushBits(bits, 0b0100, 4);
  pushBits(bits, bytes.length, countBits(version));
  for (const byte of bytes) pushBits(bits, byte, 8);
  pushBits(bits, 0, Math.min(4, capacity * 8 - bits.length));
  pushBits(bits, 0, (8 - (bits.length % 8)) % 8);
  const words: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let word = 0;
    for (let j = 0; j < 8; j++) word = (word << 1) | pick(bits, i + j);
    words.push(word);
  }
  let pad = 0xec;
  while (words.length < capacity) {
    words.push(pad);
    pad = pad === 0xec ? 0x11 : 0xec;
  }
  return words;
}

/** 블록을 나누고(짧은 블록을 먼저), 블록마다 오류 정정을 붙이고, 차례로 엮는다 */
function codewordsWithEc(data: readonly number[], version: number): number[] {
  const spec = pick(VERSIONS, version - 1);
  const shortTotal = Math.floor(spec.total / spec.blocks);
  const shortCount = spec.blocks - (spec.total % spec.blocks);
  const dataBlocks: number[][] = [];
  let offset = 0;
  for (let b = 0; b < spec.blocks; b++) {
    const length = (b < shortCount ? shortTotal : shortTotal + 1) - spec.ecPerBlock;
    dataBlocks.push(data.slice(offset, offset + length));
    offset += length;
  }
  const ecBlocks = dataBlocks.map((block) => rsRemainder(block, spec.ecPerBlock));
  const longest = Math.max(...dataBlocks.map((block) => block.length));
  const out: number[] = [];
  for (let i = 0; i < longest; i++) {
    for (const block of dataBlocks) if (i < block.length) out.push(pick(block, i));
  }
  for (let i = 0; i < spec.ecPerBlock; i++) {
    for (const block of ecBlocks) out.push(pick(block, i));
  }
  return out;
}

function blankCanvas(size: number): Canvas {
  return {
    modules: Array.from({ length: size }, () => Array.from({ length: size }, () => false)),
    reserved: Array.from({ length: size }, () => Array.from({ length: size }, () => false)),
  };
}

/** 모듈을 그리고 예약한다 */
function paint(canvas: Canvas, row: number, col: number, dark: boolean): void {
  pick(canvas.modules, row)[col] = dark;
  pick(canvas.reserved, row)[col] = true;
}

function reserve(canvas: Canvas, row: number, col: number): void {
  pick(canvas.reserved, row)[col] = true;
}

/** 형식 정보 15비트의 자리(비트 0부터). 첫 복사는 왼쪽 위 둘레, 두 번째 복사는 오른쪽 위와 왼쪽 아래 */
function formatCells(size: number): { readonly first: Cell[]; readonly second: Cell[] } {
  const first: Cell[] = [];
  for (let i = 0; i <= 5; i++) first.push([i, 8]);
  first.push([7, 8], [8, 8], [8, 7]);
  for (let i = 9; i <= 14; i++) first.push([8, 14 - i]);
  const second: Cell[] = [];
  for (let i = 0; i <= 7; i++) second.push([8, size - 1 - i]);
  for (let i = 8; i <= 14; i++) second.push([size - 15 + i, 8]);
  return { first, second };
}

/** 찾기 패턴 하나와 둘레 분리 띠(흰색). 바깥 한 줄은 격자 밖이면 건너뛴다 */
function drawFinder(canvas: Canvas, top: number, left: number): void {
  const size = canvas.modules.length;
  for (let dr = -1; dr <= 7; dr++) {
    for (let dc = -1; dc <= 7; dc++) {
      const row = top + dr;
      const col = left + dc;
      if (row < 0 || col < 0 || row >= size || col >= size) continue;
      const inside = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
      const ring = dr === 0 || dr === 6 || dc === 0 || dc === 6;
      const center = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
      paint(canvas, row, col, inside && (ring || center));
    }
  }
}

/** 정렬 패턴 중심 목록. 찾기 패턴과 겹치는 세 자리는 뺀다 */
function alignCenters(spec: VersionSpec): [number, number][] {
  const first = spec.align[0];
  const last = spec.align.at(-1);
  const centers: [number, number][] = [];
  for (const row of spec.align) {
    for (const col of spec.align) {
      if (row === first && col === first) continue;
      if (row === first && col === last) continue;
      if (row === last && col === first) continue;
      centers.push([row, col]);
    }
  }
  return centers;
}

function drawFunctionPatterns(canvas: Canvas, version: number, spec: VersionSpec): void {
  const size = canvas.modules.length;
  const cells = formatCells(size);
  for (const [row, col] of [...cells.first, ...cells.second]) reserve(canvas, row, col);
  drawFinder(canvas, 0, 0);
  drawFinder(canvas, 0, size - 7);
  drawFinder(canvas, size - 7, 0);
  for (let i = 8; i < size - 8; i++) {
    paint(canvas, 6, i, i % 2 === 0);
    paint(canvas, i, 6, i % 2 === 0);
  }
  for (const [centerRow, centerCol] of alignCenters(spec)) {
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        // 가장자리 한 겹만 흰색이다
        paint(canvas, centerRow + dr, centerCol + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
      }
    }
  }
  if (version >= 7) {
    const bits = versionWord(version);
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      paint(canvas, b, a, dark);
      paint(canvas, a, b, dark);
    }
  }
  paint(canvas, size - 8, 8, true);
}

/** 데이터 코드워드를 오른쪽 아래에서 두 열씩 위아래로 훑으며 자리에 놓는다. 남은 모듈은 흰색(나머지 비트) */
function placeData(canvas: Canvas, codewords: readonly number[]): void {
  const size = canvas.modules.length;
  const totalBits = codewords.length * 8;
  let index = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // 세로 타이밍 열은 건너뛴다
    const upward = ((right + 1) & 2) === 0;
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (let j = 0; j < 2; j++) {
        const col = right - j;
        if (pick(canvas.reserved, row)[col] === true || index >= totalBits) continue;
        const word = pick(codewords, index >> 3);
        pick(canvas.modules, row)[col] = ((word >> (7 - (index & 7))) & 1) === 1;
        index++;
      }
    }
  }
}

const MASKS: readonly ((row: number, col: number) => boolean)[] = [
  (row, col) => (row + col) % 2 === 0,
  (row) => row % 2 === 0,
  (_row, col) => col % 3 === 0,
  (row, col) => (row + col) % 3 === 0,
  (row, col) => (Math.floor(row / 2) + Math.floor(col / 2)) % 2 === 0,
  (row, col) => ((row * col) % 2) + ((row * col) % 3) === 0,
  (row, col) => (((row * col) % 2) + ((row * col) % 3)) % 2 === 0,
  (row, col) => (((row + col) % 2) + ((row * col) % 3)) % 2 === 0,
];

/** 데이터 모듈만 마스크로 뒤집는다 */
function applyMask(canvas: Canvas, mask: number): void {
  const size = canvas.modules.length;
  const hit = pick(MASKS, mask);
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (pick(canvas.reserved, row)[col] === true) continue;
      if (hit(row, col)) pick(canvas.modules, row)[col] = !cellAt(canvas.modules, row, col);
    }
  }
}

/** 형식 정보: 수준 M(00)과 마스크 3비트를 BCH(15,5)로 늘리고 마스크 0x5412를 씌운다 */
function formatWord(mask: number): number {
  const data = mask; // (수준 M 비트 00) << 3 | 마스크
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

/** 버전 정보(7 이상): 버전 6비트를 BCH(18,6)으로 늘린다 */
function versionWord(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >> 11) * 0x1f25);
  return (version << 12) | rem;
}

function drawFormat(canvas: Canvas, mask: number): void {
  const size = canvas.modules.length;
  const bits = formatWord(mask);
  const cells = formatCells(size);
  for (let i = 0; i < 15; i++) {
    const dark = ((bits >> i) & 1) === 1;
    const [row1, col1] = pick(cells.first, i);
    pick(canvas.modules, row1)[col1] = dark;
    const [row2, col2] = pick(cells.second, i);
    pick(canvas.modules, row2)[col2] = dark;
  }
}

function buildSymbol(version: number, codewords: readonly number[], mask: number): Grid {
  const spec = pick(VERSIONS, version - 1);
  const canvas = blankCanvas(17 + 4 * version);
  drawFunctionPatterns(canvas, version, spec);
  placeData(canvas, codewords);
  applyMask(canvas, mask);
  drawFormat(canvas, mask);
  return canvas.modules;
}

const FINDER_A = [true, false, true, true, true, false, true, false, false, false, false];
const FINDER_B = [false, false, false, false, true, false, true, true, true, false, true];

function matchesAt(line: readonly boolean[], start: number, pattern: readonly boolean[]): boolean {
  return pattern.every((value, k) => pick(line, start + k) === value);
}

/** 한 줄의 감점: N1(같은 색 다섯 개 이상 연속), N3(1:1:3:1:1과 밝은 네 칸) */
function lineScore(line: readonly boolean[]): number {
  let score = 0;
  let run = 1;
  for (let i = 1; i <= line.length; i++) {
    if (i < line.length && pick(line, i) === pick(line, i - 1)) {
      run++;
      continue;
    }
    if (run >= 5) score += 3 + (run - 5);
    run = 1;
  }
  for (let start = 0; start + FINDER_A.length <= line.length; start++) {
    if (matchesAt(line, start, FINDER_A) || matchesAt(line, start, FINDER_B)) score += 40;
  }
  return score;
}

/** 전체 감점 N1~N4. 값이 작을수록 좋다 */
function penalty(grid: Grid): number {
  const size = grid.length;
  let score = 0;
  let dark = 0;
  for (let i = 0; i < size; i++) {
    const column = Array.from({ length: size }, (_, row) => cellAt(grid, row, i));
    score += lineScore(pick(grid, i)) + lineScore(column);
  }
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) if (cellAt(grid, row, col)) dark++;
  }
  // N2: 같은 색 2x2 블록
  for (let row = 0; row + 1 < size; row++) {
    for (let col = 0; col + 1 < size; col++) {
      const v = cellAt(grid, row, col);
      if (
        v === cellAt(grid, row, col + 1) &&
        v === cellAt(grid, row + 1, col) &&
        v === cellAt(grid, row + 1, col + 1)
      ) {
        score += 3;
      }
    }
  }
  // N4: 검은 모듈 비율이 50%에서 5%씩 벗어난 만큼 10점
  const total = size * size;
  score += 10 * Math.floor(Math.abs(20 * dark - 10 * total) / total);
  return score;
}

/** 바이트 모드 QR 코드(수준 M)의 모듈 격자. true가 검은 모듈이다. 담을 수 없으면 too_long */
export function encodeQr(text: string): Result<boolean[][], QrEncodeError> {
  const bytes = new TextEncoder().encode(text);
  const version = versionFor(bytes.length);
  if (version === undefined) return err({ kind: "too_long" });
  const codewords = codewordsWithEc(dataCodewords(bytes, version), version);
  let best = buildSymbol(version, codewords, 0);
  let bestScore = penalty(best);
  for (let mask = 1; mask < MASKS.length; mask++) {
    const candidate = buildSymbol(version, codewords, mask);
    const score = penalty(candidate);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return ok(best);
}
