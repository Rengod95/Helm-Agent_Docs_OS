// 플러그인 호스트 프레이밍의 공용 타입. framing.ts, frame-line.ts, transfer-read.ts, transfer-write.ts가 같이 쓴다.
// 순환 import를 피하려고 따로 둔다.
import type { JsonParseError, Result } from "@fresnel/contracts";
import type {
  ClassifiedFrame,
  PluginHostFrame,
  PluginHostTransferFrameKind,
} from "@fresnel/contracts/extensions";

/** 조각 전송이 실패한 이유. 받는 쪽이 `transfer_failed`에 싣는다 */
export type TransferFailReason =
  /** 받는 쪽이 조각 전송을 켜지 않았다 */
  | "disabled"
  /** 원래 줄의 크기가 받는 쪽 상한을 넘는다. 조각을 모으기 전에 버린다 */
  | "too_large"
  /** 받는 중인 전송이 있는데 새 시작 알림이 왔다 */
  | "busy"
  /** 조각의 전송 번호나 순번이 어긋났다(빠짐, 중복, 순서 바뀜, 시작 없이 옴, 조각이 아닌 줄이 끼어듦) */
  | "order"
  /** 조각의 UTF-8 바이트 합이 시작 알림의 크기와 다르다 */
  | "size"
  /** 합친 줄의 해시가 시작 알림의 해시와 다르다 */
  | "hash"
  /** 전송 중에 입력이 끝났다 */
  | "truncated";

/**
 * 조각 전송이 실패한 프레임의 표시. `frameId`는 원래 프레임의 `id`, `frameKind`는 그 프레임이 요청인지 답인지다.
 * 시작 알림에 없으면(옛 보내는 쪽이나 알림) 둘 다 없다
 */
export interface TransferTag {
  readonly frameId?: number;
  readonly frameKind?: PluginHostTransferFrameKind;
}

/** 프레임 읽기 실패. 값이다. `frame_too_large`는 상한을 넘은 줄을 버렸다는 뜻이다. `transfer_failed`는 조각 전송 하나가 실패했다는 뜻이다 */
export type FrameReadError =
  | { readonly kind: "frame_too_large"; readonly max: number }
  | JsonParseError
  | { readonly kind: "invalid_frame"; readonly cause: unknown }
  | { readonly kind: "read_failed"; readonly cause: unknown }
  | ({
      readonly kind: "transfer_failed";
      readonly reason: TransferFailReason;
    } & TransferTag);

export type FrameReadResult = Result<ClassifiedFrame, FrameReadError>;

/** 줄을 받는 쪽. 줄 끝 `\n`은 쓰는 쪽(createFrameWriter)이 붙인다. `drained`가 없으면 sink는 언제나 받을 수 있다고 본다 */
export interface FrameSink {
  write(line: string): void;
  /** 받는 쪽이 더 받을 수 있을 때 끝나는 기다림. 조각 하나를 쓴 뒤 이것을 기다린다 */
  drained?(): Promise<void>;
}

/** 프레임 쓰기 실패. 값이다. `transfer_stalled`는 받는 쪽이 조각을 비우지 않아 전송을 접었다는 뜻이다 */
export type FrameWriteError =
  | { readonly kind: "frame_too_large"; readonly max: number }
  | { readonly kind: "encode_failed"; readonly cause: unknown }
  | { readonly kind: "write_failed"; readonly cause: unknown }
  | { readonly kind: "transfer_stalled" };

export interface FrameWriterOptions {
  /** 조각 전송을 켠다. `maxBytes`는 받는 쪽이 받을 수 있는 원래 줄의 최대 UTF-8 바이트 수다. 없으면 상한을 넘는 줄은 보내지 않는다. `setTransfer`로 바꾼다 */
  readonly transfer?: { readonly maxBytes: number };
  /** 줄 세워진 뒤 나가지 못한 프레임을 알린다. `write`가 이미 `ok`를 돌려준 프레임에 쓴다. 던지지 않아야 한다 */
  readonly onTransferFailed?: (frame: PluginHostFrame, error: FrameWriteError) => void;
  /** 조각 전송이 시작될 때(시작 알림을 쓰기 직전) 부른다. 펌프가 부르며 동기다. 던지지 않아야 한다 */
  readonly onTransferStart?: (frame: PluginHostFrame) => void;
  /** 조각 전송이 끝날 때 부른다. `ok`는 모든 조각을 보냈다는 뜻이다(실패하면 `onTransferFailed`가 이어서 간다). 던지지 않아야 한다 */
  readonly onTransferEnd?: (frame: PluginHostFrame, ok: boolean) => void;
  /** 멈춤 시계. 걸면 취소 함수를 돌려준다. 시험에서 바꾼다 */
  readonly setTimer?: (ms: number, fn: () => void) => () => void;
  /** 조각 하나를 쓴 뒤 비워지기를 기다리는 시간(ms). 넘으면 그 프레임의 전송을 접는다 */
  readonly stallMs?: number;
}
