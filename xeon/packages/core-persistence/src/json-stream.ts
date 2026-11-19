// 큰 값을 조각으로 내보내는 원천과 조각 지문(L1.persistence.spec §4.11). 값 전체의 글이나 사본을 만들지 않는다.
// 조각을 이어 붙이면 `TextEncoder.encode`(글)와 `JSON.stringify`(JSON 값)의 바이트와 같다. 지문은 `canonicalJson`의 바이트를 그대로 해시한다.
import { createHash } from "node:crypto";
import { Bug } from "@fresnel/contracts";
import { isPlainJsonText, type BlobStreamSource } from "@fresnel/contracts/records";

/** 글을 한 번에 `encodeInto`에 넘기는 글자 수 상한. 바이트로는 최대 3배다 */
const STRING_STEP_UNITS: number = 1024 * 1024;
/** 글 조각의 버퍼 크기(바이트). 한 번의 `sink` 호출이 넘기는 최대 바이트다 */
const STRING_BUFFER_BYTES: number = 1024 * 1024;
/** JSON 조각의 버퍼 크기(바이트). 값 전체가 아니라 이만큼씩 `sink`로 보낸다 */
const JSON_BUFFER_BYTES: number = 64 * 1024;
/** JSON 문자열 잎을 한 번에 이스케이프하는 글자 수. 잎 전체를 이스케이프한 글로 만들지 않는다(이스케이프는 최대 여섯 배다) */
const LEAF_SLICE_UNITS: number = 16 * 1024;

/** 이 글자 수 이하의 ASCII 글은 `encodeInto` 없이 바이트를 직접 넣는다 */
const SHORT_ASCII_UNITS: number = 4096;

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const COMMA = 0x2c;
const COLON = 0x3a;
const OPEN_BRACE = 0x7b;
const CLOSE_BRACE = 0x7d;
const OPEN_BRACKET = 0x5b;
const CLOSE_BRACKET = 0x5d;

const encoder = new TextEncoder();

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * `from`에서 시작해 최대 `units`글자까지의 끝 위치. 높은 서로게이트에서 끊으면 한 글자 앞에서 끊어 서로게이트 짝을 가르지 않는다.
 * 글의 끝이면 그 자리가 끝이다. 짝 없는 서로게이트는 `TextEncoder`와 같이 U+FFFD로 쓰이므로 여기서는 손대지 않는다
 */
function sliceEnd(text: string, from: number, units: number): number {
  const end = Math.min(text.length, from + units);
  if (end < text.length && isHighSurrogate(text.charCodeAt(end - 1))) return end - 1;
  return end;
}

/**
 * 글을 UTF-8 조각으로 내보내는 원천. 글 전체를 한 번에 인코딩하지 않는다. 한 버퍼를 되풀이해 채우고 그때마다 `sink`로 넘긴다.
 * `size`는 `stringUtf8Sizes(text).utf8`이어야 한다(저장소가 실제 쓴 바이트 수와 대조한다).
 */
export function stringBlobSource(text: string, size: number): BlobStreamSource {
  return {
    size,
    produce(sink): void {
      const buffer = new Uint8Array(STRING_BUFFER_BYTES);
      let pos = 0;
      while (pos < text.length) {
        const end = sliceEnd(text, pos, STRING_STEP_UNITS);
        const { read, written } = encoder.encodeInto(text.slice(pos, end), buffer);
        // 버퍼에는 최대 4바이트짜리 글자 하나가 늘 들어가므로 진행이 멈추는 일은 없다. 그래도 멈추면 결함이다
        if (read === 0)
          throw new Bug("store.blob_encode_stalled: the string piece made no progress");
        sink(buffer.subarray(0, written));
        pos += read;
      }
    },
  };
}

/** JSON 조각 쓰기 도구: 한 바이트 기호와 글을 버퍼에 쌓고 가득 차면 `sink`로 넘긴다 */
interface ChunkWriter {
  byte(code: number): void;
  text(text: string): void;
  flush(): void;
}

function isAscii(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) >= 0x80) return false;
  }
  return true;
}

function chunkWriter(sink: (chunk: Uint8Array) => void): ChunkWriter {
  const buffer = new Uint8Array(JSON_BUFFER_BYTES);
  let at = 0;
  const flush = (): void => {
    if (at > 0) {
      sink(buffer.subarray(0, at));
      at = 0;
    }
  };
  return {
    byte(code: number): void {
      if (at === buffer.byteLength) flush();
      buffer[at] = code;
      at += 1;
    },
    text(text: string): void {
      // 짧은 ASCII(키, 수, 기호 글)는 바이트를 바로 넣는다. 부분 배열 뷰를 만들지 않아 조각마다 쓰레기를 남기지 않는다
      if (text.length <= SHORT_ASCII_UNITS && isAscii(text)) {
        if (at + text.length > buffer.byteLength) flush();
        for (let i = 0; i < text.length; i += 1) {
          buffer[at] = text.charCodeAt(i);
          at += 1;
        }
        return;
      }
      let pos = 0;
      while (pos < text.length) {
        const { read, written } = encoder.encodeInto(
          pos === 0 ? text : text.slice(pos),
          buffer.subarray(at),
        );
        at += written;
        pos += read;
        // 버퍼에 안 들어간 나머지는 비운 뒤 이어서 쓴다
        if (pos < text.length) flush();
      }
    },
    flush,
  };
}

/** 짧은 글이 이스케이프 없는 출력 가능한 ASCII뿐인가(정규식을 쓰지 않는다: 키마다 쓰레기를 남기지 않게 한다) */
function isPlainShortText(text: string): boolean {
  if (text.length > SHORT_ASCII_UNITS) return false;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || code > 0x7e || code === QUOTE || code === BACKSLASH) return false;
  }
  return true;
}

/** JSON 문자열 하나를 `JSON.stringify`와 같은 바이트로 쓴다. 긴 잎은 글자 묶음으로 잘라 쓴다 */
function writeJsonString(out: ChunkWriter, text: string): void {
  out.byte(QUOTE);
  if (isPlainShortText(text) || (text.length > SHORT_ASCII_UNITS && isPlainJsonText(text))) {
    // 출력 가능한 ASCII는 이스케이프가 없어 글을 그대로 쓴다
    out.text(text);
  } else {
    let pos = 0;
    while (pos < text.length) {
      const end = sliceEnd(text, pos, LEAF_SLICE_UNITS);
      out.text(JSON.stringify(text.slice(pos, end)).slice(1, -1));
      pos = end;
    }
  }
  out.byte(QUOTE);
}

/** 키 순서를 `canonicalJson`과 같이 정한다(UTF-16 코드 단위 순서) */
function sortedEntries(node: object): [string, unknown][] {
  return Object.entries(node).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * 값을 쓴다. `canonical`이 거짓이면 `JSON.stringify`와 같은 순서와 바이트(삽입 순서, 배열의 undefined는 null)다.
 * 참이면 `canonicalJson`과 같다(키를 정렬하고, 배열의 undefined와 유한하지 않은 수와 함수·심볼은 Bug다)
 */
function writeValue(out: ChunkWriter, node: unknown, canonical: boolean): void {
  if (typeof node === "string") {
    writeJsonString(out, node);
    return;
  }
  if (Array.isArray(node)) {
    const items: readonly unknown[] = node;
    out.byte(OPEN_BRACKET);
    // 색인으로 돈다. entries()는 원소마다 짝 배열을 만들어 쓰레기를 남긴다
    for (let index = 0; index < items.length; index += 1) {
      if (index > 0) out.byte(COMMA);
      const item = items[index];
      if (canonical && item === undefined) {
        throw new Bug("canonicalJson: undefined array item");
      }
      writeValue(out, item, canonical);
    }
    out.byte(CLOSE_BRACKET);
    return;
  }
  if (typeof node === "object" && node !== null) {
    out.byte(OPEN_BRACE);
    let first = true;
    const entries = canonical ? sortedEntries(node) : Object.entries(node);
    for (const [key, member] of entries) {
      // JSON.stringify와 canonicalJson은 undefined 멤버를 건너뛴다
      if (member === undefined) continue;
      if (!first) out.byte(COMMA);
      first = false;
      writeJsonString(out, key);
      out.byte(COLON);
      writeValue(out, member, canonical);
    }
    out.byte(CLOSE_BRACE);
    return;
  }
  if (canonical) {
    if (node === undefined) throw new Bug("canonicalJson: unsupported undefined");
    if (typeof node === "number" && !Number.isFinite(node)) {
      throw new Bug("canonicalJson: non-finite number");
    }
    if (typeof node === "function" || typeof node === "symbol" || typeof node === "bigint") {
      throw new Bug(`canonicalJson: unsupported ${typeof node}`);
    }
  }
  // 최상위와 객체 멤버의 undefined는 위에서 걸러진다. 여기 오는 undefined는 배열 안의 것이라 null이다
  out.text(node === undefined ? "null" : JSON.stringify(node));
}

/** 함수와 심볼이 없는 값인가. 있으면 `JSON.stringify`가 그 멤버를 건너뛰어 미리 잰 크기와 어긋나므로 옛 방식에 맡긴다 */
function isStreamableJson(node: unknown): boolean {
  if (typeof node === "function" || typeof node === "symbol") return false;
  if (Array.isArray(node)) {
    const items: readonly unknown[] = node;
    return items.every(isStreamableJson);
  }
  if (typeof node === "object" && node !== null) {
    return Object.values(node).every(isStreamableJson);
  }
  return true;
}

/**
 * JSON 값을 `JSON.stringify`와 같은 UTF-8 바이트로 내보내는 원천. 값 전체의 글을 만들지 않고 버퍼 하나를 되풀이해 채운다.
 * `size`는 `jsonUtf8Length(value)`이어야 한다. 함수나 심볼이 들어 있으면 undefined다(호출자가 옛 방식으로 쓴다).
 */
export function jsonBlobSource(value: unknown, size: number): BlobStreamSource | undefined {
  if (!isStreamableJson(value)) return undefined;
  return {
    size,
    produce(sink): void {
      const out = chunkWriter(sink);
      writeValue(out, value, false);
      out.flush();
    },
  };
}

/**
 * 조각을 미리 잰 크기의 버퍼 하나에 모은다(조각 저장소가 없는 저장소용 옛 방식). 쓴 바이트가 크기와 다르면 undefined다
 */
export function collectBlobSource(source: BlobStreamSource): Uint8Array | undefined {
  const out = new Uint8Array(source.size);
  const state = { bytes: 0, overflow: false };
  source.produce((chunk) => {
    if (state.bytes + chunk.byteLength > out.byteLength) {
      state.overflow = true;
      return;
    }
    out.set(chunk, state.bytes);
    state.bytes += chunk.byteLength;
  });
  return !state.overflow && state.bytes === out.byteLength ? out : undefined;
}

/**
 * `canonicalJson(value)`의 SHA-256 hex. 정렬된 글을 만들지 않고 조각마다 해시에 넣는다. 결과는 `sha256Hex(canonicalJson(value))`와 같다.
 * 커밋 지문이 큰 값을 담아도 그 글의 사본을 만들지 않는다(L0.store의 지문 규칙은 바꾸지 않는다)
 */
export function canonicalJsonSha256Hex(value: unknown): string {
  const hash = createHash("sha256");
  const out = chunkWriter((chunk) => {
    hash.update(chunk);
  });
  writeValue(out, value, true);
  out.flush();
  return hash.digest("hex");
}
