import type { ReadableStreamReadResult } from "node:stream/web";
import { attemptAsync, err, ok, parseJson, type Result } from "@fresnel/contracts";
import {
  parseScanRequest,
  scanJsonReplacer,
  scanRoots,
  type MigrationScan,
  type ScanDiagnostic,
  type ScanRequest,
  type SourceItem,
} from "@fresnel/plugin-migration";
import { collectInOrder } from "../assembly/plugins/in-order.ts";
import { createScanFs } from "../assembly/plugins/migration-fs.ts";
import type { CommandIo } from "../host-command.ts";

// 훑기 자식 프로세스의 본체(`migration-scan --stdio`, migration.md §7.4 [제안]). 엔진이 샌드박스에 넣어 띄운다.
// 표준 입력: 요청 줄 하나(`ScanRequest`, 루트는 엔진이 정규 경로로 바꾼 값). 표준 출력: 루트마다 진행 줄 하나, 끝에 응답 줄 하나.
// 읽기는 `createScanFs`(루트 밖과 `..`와 심볼릭 링크 밖을 따라가지 않는다)로만 한다. 쓰기, 프로세스, 네트워크가 없다.
// 항목 상한은 `createScanFs`가 세고 응답의 `limitReached`로 알린다. 바이트는 `scanJsonReplacer`로 base64가 된다.
// 실패는 `{kind:"error", code}` 한 줄이다(원문과 경로를 싣지 않는다). 엔진은 이 줄을 `parseScanChildLine`으로 받는다.

/** 요청 줄의 상한. 루트 경로만 담으므로 넉넉하다 */
const REQUEST_MAX_BYTES = 1024 * 1024;

const ENCODER = new TextEncoder();

/** 읽는 쪽. 덩어리를 하나씩 내는 모양만 본다 */
interface ChunkReader {
  read(): Promise<ReadableStreamReadResult<Uint8Array>>;
}

/** 표준 입력에서 첫 줄을 읽는다. 줄바꿈 없이 끝나거나 상한을 넘으면 `bad_request`다 */
async function readRequestLine(
  stream: ReadableStream<Uint8Array>,
): Promise<Result<string, "bad_request">> {
  return readFrom(stream.getReader(), new TextDecoder("utf-8"), "", 0);
}

/** 덩어리를 하나씩 읽는다. 루프 대신 재귀로 쓴다(검사가 루프 안 `await`를 막는다) */
async function readFrom(
  reader: ChunkReader,
  decoder: TextDecoder,
  text: string,
  size: number,
): Promise<Result<string, "bad_request">> {
  const next = await attemptAsync(() => reader.read());
  if (!next.ok) return err("bad_request");
  const read = next.value;
  if (read.done) {
    const rest = text + decoder.decode();
    return rest.length === 0 ? err("bad_request") : ok(rest);
  }
  const total = size + read.value.byteLength;
  if (total > REQUEST_MAX_BYTES) return err("bad_request");
  const grown = text + decoder.decode(read.value, { stream: true });
  const end = grown.indexOf("\n");
  if (end !== -1) return ok(grown.slice(0, end));
  return readFrom(reader, decoder, grown, total);
}

/** 줄 하나를 쓴다. 바이트 배열은 치환 함수로 base64가 된다. 쓰지 못했으면 거짓이다 */
async function emit(io: CommandIo, line: unknown): Promise<boolean> {
  const writer = io.stdout.getWriter();
  const written = await attemptAsync(() =>
    writer.write(ENCODER.encode(`${JSON.stringify(line, scanJsonReplacer)}\n`)),
  );
  writer.releaseLock();
  return written.ok;
}

/** 실패 응답을 쓰고 종료코드 1을 돌려준다. 응답을 못 쓰면 엔진은 자식이 응답 없이 끝났다고 본다 */
async function fail(io: CommandIo, code: "bad_request" | "scan_failed"): Promise<1> {
  await emit(io, { kind: "error", code });
  return 1;
}

/** 항목의 정렬 순서. 라이브러리 `scanRoots`와 같은 규칙(경로, 키 경로, 항목 id)이다 */
function bySourcePlace(a: SourceItem, b: SourceItem): number {
  if (a.path !== b.path) return a.path < b.path ? -1 : 1;
  const keyA = a.keyPath ?? "";
  const keyB = b.keyPath ?? "";
  if (keyA !== keyB) return keyA < keyB ? -1 : 1;
  if (a.itemId === b.itemId) return 0;
  return a.itemId < b.itemId ? -1 : 1;
}

/** 루트마다 따로 훑은 결과를 하나로 모은다. 같은 `itemId`는 처음 것만 둔다(라이브러리 `scanRoots`와 같다) */
function mergeScans(parts: readonly MigrationScan[]): {
  readonly scanned: readonly string[];
  readonly items: readonly SourceItem[];
  readonly diagnostics: readonly ScanDiagnostic[];
} {
  const seen = new Set<string>();
  const items: SourceItem[] = [];
  for (const part of parts) {
    for (const item of part.items) {
      if (seen.has(item.itemId)) continue;
      seen.add(item.itemId);
      items.push(item);
    }
  }
  return {
    scanned: [...new Set(parts.flatMap((part) => part.scanned))].toSorted(),
    items: items.toSorted(bySourcePlace),
    diagnostics: parts.flatMap((part) => part.diagnostics),
  };
}

async function scanAll(io: CommandIo, request: ScanRequest): Promise<0 | 1> {
  const guard = createScanFs(request.roots.map((root) => root.path));
  let done = 0;
  // 루트는 차례로 훑는다. 진행 줄의 순서가 루트 순서와 같아야 한다
  const parts = await collectInOrder(
    request.roots,
    async (root): Promise<Result<readonly MigrationScan[], "scan_failed">> => {
      const part = await attemptAsync(() =>
        scanRoots({ roots: [root], fs: guard.fs, ctx: { homeDir: request.homeDir } }),
      );
      if (!part.ok) return err("scan_failed");
      done += 1;
      const reported = await emit(io, {
        kind: "progress",
        done,
        total: request.roots.length,
      });
      return reported ? ok([part.value]) : err("scan_failed");
    },
  );
  if (!parts.ok) return fail(io, "scan_failed");
  const merged = mergeScans(parts.value);
  const limitReached =
    guard.limitReached() || merged.diagnostics.some((item) => item.code === "limit");
  const sent = await emit(io, {
    kind: "ok",
    limitReached,
    scan: { scanned: merged.scanned, items: merged.items, diagnostics: merged.diagnostics },
  });
  return sent ? 0 : 1;
}

/** `migration-scan --stdio`를 실행하고 종료코드를 돌려준다. 끝 응답을 쓰면 0, 실패 응답이나 입력 오류면 1이다 */
export async function runMigrationScanStdio(io: CommandIo): Promise<0 | 1> {
  const line = await readRequestLine(io.stdin);
  if (!line.ok) return fail(io, "bad_request");
  const json = parseJson(line.value);
  if (!json.ok) return fail(io, "bad_request");
  const request = parseScanRequest(json.value);
  if (!request.ok) return fail(io, "bad_request");
  return scanAll(io, request.value);
}
