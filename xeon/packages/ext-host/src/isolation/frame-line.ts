// 줄 글을 프레임으로 읽는다. 오류 값에는 줄 글을 싣지 않는다(X.loading-trust §4.9.3). JSON 파싱 오류의 원문에는 글이 들어 있을 수 있다.
import { err, ok, parse, parseJson } from "@fresnel/contracts";
import {
  classifyFrame,
  PLUGIN_HOST_TRANSFER_BEGIN,
  PLUGIN_HOST_TRANSFER_PART,
  RawPluginHostFrameSchema,
} from "@fresnel/contracts/extensions";
import type { FrameReadResult } from "./framing-types.ts";

const decoder = new TextDecoder();

/** 줄 하나(줄 끝 제외)의 바이트를 프레임으로 본다. 빈 줄은 프레임이 아니다 */
export function frameOfLine(bytes: Uint8Array): FrameReadResult | undefined {
  if (bytes.byteLength === 0) return undefined;
  return frameOfText(decoder.decode(bytes));
}

/** 줄 글 하나를 프레임으로 읽는다. 조각 알림도 이 함수가 읽는다(조각 읽기가 소비한다) */
function frameOfText(text: string): FrameReadResult {
  const json = parseJson(text);
  if (!json.ok) return err({ kind: "parse_json", cause: "the line is not JSON" });
  const raw = parse(RawPluginHostFrameSchema, json.value);
  if (!raw.ok) return err({ kind: "invalid_frame", cause: raw.error });
  const classified = classifyFrame(raw.value);
  if (!classified.ok) return err({ kind: "invalid_frame", cause: classified.error });
  return ok(classified.value);
}

/**
 * 조각을 모아 합친 글을 프레임으로 읽는다. 합친 프레임은 조각 알림 메서드를 가질 수 없다(조각 안의 조각은 없다).
 * 가지면 `invalid_frame`이다
 */
export function frameOfJoined(text: string): FrameReadResult {
  const frame = frameOfText(text);
  if (!frame.ok) return frame;
  const method = "method" in frame.value ? frame.value.method : undefined;
  if (method === PLUGIN_HOST_TRANSFER_BEGIN || method === PLUGIN_HOST_TRANSFER_PART) {
    return err({ kind: "invalid_frame", cause: "a transfer frame cannot be transferred" });
  }
  return frame;
}
