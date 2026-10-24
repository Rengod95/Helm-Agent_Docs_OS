import { detach, type Logger, type Scheduler } from "@xeon/contracts";
import type { HostShutdownParams, HostShutdownResult, Transport } from "@xeon/contracts/wire";
import type { ProcessShutdown } from "./shutdown.ts";

// L0.process.spec §3.2·§4.2, L0.process.plan PR-05. 자식 엔진 수명 임대.
// 부모(데스크톱)가 쥔 stdin 파이프가 임대다. 부모가 어떻게 끝나도 OS가 쓰기 끝을 닫아 자식이 EOF를 읽는다.
// stdin은 stdio 전송이 읽는 스트림 하나뿐이다(두 번째 reader를 붙일 수 없다). 그래서 EOF는 전송의 onClose로 받는다.

function describe(caught: unknown): string {
  return caught instanceof Error ? caught.message : "non_error_thrown";
}

export interface ChildLeaseOptions {
  /** 자식 엔진의 stdio 전송. 읽기 쪽 EOF 또는 읽기 오류(`eof`, `error`)를 임대 해제로 본다 */
  readonly transport: Pick<Transport, "onClose">;
  /** 협조 종료가 시한 안에 끝나면 0으로 부른다. 시한 초과의 exit(1)은 `ProcessShutdown`이 부른다 */
  readonly exit: (code: number) => never;
  readonly logger?: Logger;
}

/**
 * stdin EOF를 수명 임대 해제로 보고 종료 협조를 시작한다. 복구 표식은 지우지 않는다(다음 실행이 '이어서 실행' 후보로 본다).
 * 반환값을 dispose하면 감시를 푼다.
 */
export function watchChildLease(
  coordinator: ProcessShutdown,
  options: ChildLeaseOptions,
): Disposable {
  const unsubscribe = options.transport.onClose((info) => {
    if (info.reason !== "eof" && info.reason !== "error") return;
    options.logger?.info("lease.lost", { reason: info.reason });
    detach(
      coordinator.request("stdin_eof").then((outcome) => {
        if (outcome.completed) options.exit(0);
        return undefined;
      }),
      (caught) => {
        options.logger?.error("lease.shutdown_failed", { error: describe(caught) });
      },
    );
  });
  return {
    [Symbol.dispose]() {
      unsubscribe();
    },
  };
}

export interface HostShutdownHandlerOptions {
  readonly coordinator: ProcessShutdown;
  /** 응답을 쓴 뒤 닫아 쓰기 큐를 비운다 */
  readonly transport: Pick<Transport, "close">;
  readonly scheduler: Scheduler;
  readonly exit: (code: number) => never;
  readonly logger?: Logger;
}

/**
 * `host.shutdown` 처리기 본체(L0.process.spec §4.2, FR-P1). 참여자 처리가 끝난 뒤에 `{ accepted: true }`를 돌려준다.
 * 호스트(L4)가 와이어 처리기에서 부른다. 응답은 처리기가 돌려준 뒤 호출자가 전송으로 보내므로,
 * 다음 매크로 태스크에서 전송을 닫아(쓰기 큐 비움) 응답이 나간 뒤에 종료코드 0으로 끝낸다.
 * 시한을 넘기면 `ProcessShutdown`이 exit(1)을 부르므로 여기서는 부르지 않는다.
 */
export function createHostShutdownHandler(
  options: HostShutdownHandlerOptions,
): (params: HostShutdownParams) => Promise<HostShutdownResult> {
  return async (params) => {
    const reason = params.reason === "version_replace" ? "version_replace" : "shutdown_request";
    const outcome = await options.coordinator.request(reason);
    if (outcome.completed) {
      options.scheduler.setTimeout(() => {
        detach(
          options.transport.close("shutdown").then(() => {
            options.exit(0);
            return undefined;
          }),
          (caught) => {
            options.logger?.error("shutdown.close_failed", { error: describe(caught) });
          },
        );
      }, 0);
    }
    return { accepted: true };
  };
}
