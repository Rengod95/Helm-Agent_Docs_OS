import { attemptAsync, detach, err, ok, type Result } from "@fresnel/contracts";
import { runPluginHost, type FrameSink, type PluginHostExit } from "@fresnel/ext-host";
import type { CommandIo } from "../host-command.ts";
import { HOST_SDK_MODULES } from "./sdk-modules.ts";

// L4.host-service.spec §3.2, §4.9. `plugin-host --stdio`의 본체. 엔진이 띄운 플러그인 호스트 프로세스 하나를 돌린다.
// 설정과 저장소를 열지 않는다. 입력은 표준입력(엔진이 쓴 줄), 출력은 표준출력(엔진이 읽는 줄), 진단은 표준오류다.
// 끝나는 이유는 `PluginHostExit`다. 정상 끝(disposed, stdin_closed)은 0, 시작 실패와 루프 실패(init_failed, fault)는 1이다.

export type PluginHostStdioCode = 0 | 1;

export function exitCodeOf(exit: PluginHostExit): PluginHostStdioCode {
  return exit === "disposed" || exit === "stdin_closed" ? 0 : 1;
}

/** 표준입력의 덩어리를 읽는 비동기 순회. 읽기 실패는 던져져 실행 루프가 `fault`로 받는다 */
async function* chunksOf(stream: ReadableStream<Uint8Array>): AsyncIterable<Uint8Array> {
  yield* stream;
}

interface LineSink {
  readonly sink: FrameSink;
  /** 쓰기를 모두 기다리고 닫는다. 쓰기 하나라도 실패했으면 그 원인을 값으로 돌려준다 */
  close(): Promise<Result<void, { readonly kind: "write_failed"; readonly cause: unknown }>>;
}

/**
 * 줄 싱크를 쓰기 큐로 만든다. 줄 끝 `\n`은 쓰는 쪽(framing)이 이미 붙였다. 쓰기 실패는 기록해 두고 닫을 때 값으로 돌려준다.
 * 비워지기를 기다릴 수 있어(`drained`) 조각 전송의 역압이 자식의 표준출력까지 닿는다
 */
function lineSinkOf(stream: WritableStream<Uint8Array>): LineSink {
  const writer = stream.getWriter();
  const encoder = new TextEncoder();
  const failures: unknown[] = [];
  return {
    sink: {
      write(line) {
        detach(writer.write(encoder.encode(line)), (caught) => {
          failures.push(caught);
        });
      },
      // 큰 줄의 조각 전송은 조각마다 이 기다림을 받아 쓰기 큐가 쌓이지 않게 한다(AGE-59 역압). 쓰기가 실패하면 기다림도 실패한다
      drained() {
        return writer.ready;
      },
    },
    async close() {
      const closed = await attemptAsync(() => writer.close());
      if (!closed.ok) return err({ kind: "write_failed", cause: closed.error.cause });
      const [first] = failures;
      if (failures.length > 0) return err({ kind: "write_failed", cause: first });
      return ok(undefined);
    },
  };
}

/** `plugin-host --stdio`를 실행하고 끝나면 종료코드를 돌려준다. 프로세스를 끝내는 일은 진입 파일이 한다 */
export async function runPluginHostStdio(io: CommandIo): Promise<PluginHostStdioCode> {
  const out = lineSinkOf(io.stdout);
  const diagnostics = lineSinkOf(io.stderr);
  const exit = await runPluginHost({
    input: chunksOf(io.stdin),
    output: out.sink,
    stderr: diagnostics.sink,
    sdkModules: HOST_SDK_MODULES,
  });
  // 출력이나 진단을 다 쓰지 못했으면(엔진이 읽기를 끊은 경우) 끝난 이유와 상관없이 실패로 본다
  const flushed = await out.close();
  const diagnosticsFlushed = await diagnostics.close();
  if (!flushed.ok || !diagnosticsFlushed.ok) return 1;
  return exitCodeOf(exit);
}
