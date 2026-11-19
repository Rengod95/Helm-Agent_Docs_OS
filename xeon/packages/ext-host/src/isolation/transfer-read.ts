// 조각 전송의 읽는 쪽(AGE-59). `frame.begin`과 `frame.part` 알림을 모아 원래 줄의 프레임 하나로 되돌린다.
// 한 번에 받는 전송은 하나다. 실패하면 `transfer_failed` 값 하나를 내고, 그 전송의 남은 조각은 다음 정상 줄이 올 때까지 조용히 버린다.
// 보내는 쪽은 전송을 끝까지 보내거나 접은 뒤에야 다음 줄을 보낸다(FIFO). 그래서 조각이 아닌 줄이 오면 받던 전송은 끝난 것이다.
import { createHash, type Hash } from "node:crypto";
import { err, parse } from "@fresnel/contracts";
import {
  PLUGIN_HOST_TRANSFER_BEGIN,
  PLUGIN_HOST_TRANSFER_PART,
  PLUGIN_HOST_TRANSFER_PART_CHARS,
  PluginHostTransferBeginSchema,
  PluginHostTransferPartSchema,
  type PluginHostTransferPart,
} from "@fresnel/contracts/extensions";
import { stringUtf8Sizes } from "@fresnel/contracts/records";
import { frameOfJoined } from "./frame-line.ts";
import type {
  FrameReadError,
  FrameReadResult,
  TransferFailReason,
  TransferTag,
} from "./framing-types.ts";

export interface TransferAssembler {
  /** 줄 하나의 결과를 넣는다. 조각 알림은 내보내지 않고, 합쳐진 프레임이나 실패 값을 내보낸다 */
  accept(item: FrameReadResult): readonly FrameReadResult[];
  /** 입력이 끝났다. 받던 전송이 있으면 `truncated` 실패를 낸다 */
  finish(): readonly FrameReadResult[];
}

/** 받는 중인 전송 하나 */
interface Receiving {
  readonly x: number;
  readonly tag: TransferTag;
  readonly size: number;
  readonly parts: number;
  readonly sha256: string;
  readonly hash: Hash;
  readonly texts: string[];
  /** 다음에 받을 조각의 순번 */
  next: number;
  /** 지금까지 받은 조각의 UTF-8 바이트 수 */
  bytes: number;
}

/** 받지 않는 상태(`idle`), 받는 중(`receiving`), 실패한 전송의 남은 조각을 버리는 중(`discarding`) */
type State =
  | { readonly kind: "idle" }
  | { readonly kind: "discarding" }
  | { readonly kind: "receiving"; readonly transfer: Receiving };

const IDLE: State = { kind: "idle" };
const DISCARDING: State = { kind: "discarding" };
/** 시작 알림에 `frameId`가 없는 실패 표시 */
const NO_TAG: TransferTag = {};

/**
 * 조각 전송을 받는 상태 기계를 만든다. `maxBytes`는 받을 수 있는 원래 줄의 최대 UTF-8 바이트 수다.
 * 없으면 조각 전송을 받지 않는다(시작 알림마다 `disabled`).
 */
export function createTransferAssembler(maxBytes: number | undefined): TransferAssembler {
  let state: State = IDLE;

  /** 정상 줄은 받던 전송을 끝낸다. 받던 전송이 있었으면 그 전송은 순번 오류다 */
  function plain(item: FrameReadResult): readonly FrameReadResult[] {
    const interrupted = state.kind === "receiving" ? [failure("order", state.transfer.tag)] : [];
    state = IDLE;
    return [...interrupted, item];
  }

  /** 줄 오류는 조각이 깨졌을 수 있다. 받던 전송을 순번 오류로 끝내고 남은 조각을 버린다 */
  function lineFailed(error: FrameReadError): readonly FrameReadResult[] {
    if (state.kind !== "receiving") return [err(error)];
    const interrupted = failure("order", state.transfer.tag);
    state = DISCARDING;
    return [interrupted, err(error)];
  }

  /** 시작 알림을 받지 않는다. 실패 하나를 내고 그 전송의 남은 조각을 버린다 */
  function refuse(reason: TransferFailReason, tag: TransferTag): readonly FrameReadResult[] {
    state = DISCARDING;
    return [failure(reason, tag)];
  }

  function begin(params: unknown): readonly FrameReadResult[] {
    const parsed = parse(PluginHostTransferBeginSchema, params);
    if (!parsed.ok) return lineFailed({ kind: "invalid_frame", cause: parsed.error });
    const { x, size, parts, sha256 } = parsed.value;
    const tag = tagOf(parsed.value);
    if (!partsFit(size, parts)) {
      return lineFailed({ kind: "invalid_frame", cause: "the part count does not fit the size" });
    }
    if (maxBytes === undefined) return refuse("disabled", tag);
    if (state.kind === "receiving") return refuse("busy", tag);
    if (size > maxBytes) return refuse("too_large", tag);
    state = {
      kind: "receiving",
      transfer: {
        x,
        tag,
        size,
        parts,
        sha256,
        hash: createHash("sha256"),
        texts: [],
        next: 0,
        bytes: 0,
      },
    };
    return [];
  }

  function part(params: unknown): readonly FrameReadResult[] {
    const parsed = parse(PluginHostTransferPartSchema, params);
    if (!parsed.ok) return lineFailed({ kind: "invalid_frame", cause: parsed.error });
    if (state.kind === "idle") {
      // 시작 없이 온 조각. 같은 전송의 남은 조각이 더 올 수 있어 버리는 상태로 간다
      state = DISCARDING;
      return [failure("order", NO_TAG)];
    }
    if (state.kind === "discarding") return [];
    return take(state.transfer, parsed.value);
  }

  /** 조각 하나를 받는다. 마지막 조각이면 합쳐 검사한다 */
  function take(transfer: Receiving, piece: PluginHostTransferPart): readonly FrameReadResult[] {
    if (piece.x !== transfer.x || piece.i !== transfer.next) return abandon("order", transfer);
    const bytes = stringUtf8Sizes(piece.data).utf8;
    if (transfer.bytes + bytes > transfer.size) return abandon("size", transfer);
    transfer.hash.update(piece.data);
    transfer.texts.push(piece.data);
    transfer.bytes += bytes;
    transfer.next += 1;
    if (transfer.next < transfer.parts) return [];
    state = IDLE;
    return [complete(transfer)];
  }

  function abandon(reason: TransferFailReason, transfer: Receiving): readonly FrameReadResult[] {
    state = DISCARDING;
    return [failure(reason, transfer.tag)];
  }

  function accept(item: FrameReadResult): readonly FrameReadResult[] {
    if (!item.ok) return lineFailed(item.error);
    const frame = item.value;
    if (frame.kind === "notification" && frame.method === PLUGIN_HOST_TRANSFER_BEGIN) {
      return begin(frame.params);
    }
    if (frame.kind === "notification" && frame.method === PLUGIN_HOST_TRANSFER_PART) {
      return part(frame.params);
    }
    return plain(item);
  }

  function finish(): readonly FrameReadResult[] {
    const open = state;
    state = IDLE;
    return open.kind === "receiving" ? [failure("truncated", open.transfer.tag)] : [];
  }

  return { accept, finish };
}

/**
 * 조각 수가 크기와 맞는가. 조각은 글자 `PLUGIN_HOST_TRANSFER_PART_CHARS`를 넘지 않고, 글자 하나는 UTF-8 세 바이트를 넘지 않으며,
 * 조각은 글자 하나 이상이다. 그래서 조각 수는 `ceil(size / (3 * 조각 글자 수))`보다 적을 수 없고 `size`보다 많을 수 없다
 */
function partsFit(size: number, parts: number): boolean {
  const fewest = Math.ceil(size / (3 * PLUGIN_HOST_TRANSFER_PART_CHARS));
  return parts >= fewest && parts <= size;
}

/**
 * 마지막 조각을 받은 뒤의 검사. 글은 여기서 한 번만 합쳐 파싱한다. 합친 뒤에는 조각의 참조를 놓는다(`texts`를 비운다).
 * 측정에서 최고 메모리는 거의 줄지 않았다(100 MiB에서 358 → 352 MiB): 최고점은 파싱이 글 사본을 하나 더 만들 때다
 */
function complete(transfer: Receiving): FrameReadResult {
  if (transfer.bytes !== transfer.size) return failure("size", transfer.tag);
  if (transfer.hash.digest("hex") !== transfer.sha256) return failure("hash", transfer.tag);
  const joined = transfer.texts.join("");
  transfer.texts.length = 0;
  return frameOfJoined(joined);
}

/** 전송 실패 값 하나. 오류 값에는 조각의 글도 해시도 싣지 않는다 */
function failure(reason: TransferFailReason, tag: TransferTag): FrameReadResult {
  return err({ kind: "transfer_failed", reason, ...tag });
}

/** 시작 알림의 `frameId`와 `frameKind`를 실패 표시로 옮긴다. 있는 칸만 싣는다 */
function tagOf(begin: {
  readonly frameId?: number;
  readonly frameKind?: TransferTag["frameKind"];
}): TransferTag {
  const frameId = begin.frameId;
  const frameKind = begin.frameKind;
  return {
    ...(frameId === undefined ? {} : { frameId }),
    ...(frameKind === undefined ? {} : { frameKind }),
  };
}
