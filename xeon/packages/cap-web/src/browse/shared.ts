import { parse } from "@fresnel/contracts";
import { CapabilityError, WebBrowse, type BrowseSnapshot } from "@fresnel/contracts/capabilities";
import {
  Type,
  type Static,
  type TInteger,
  type TLiteral,
  type TObject,
  type TString,
  type TUnion,
} from "typebox";

// 브라우저 provider 둘(playwright-mcp, stagehand)이 같이 쓰는 값과 도우미(L2.web.spec §4.10.4a).
// 여기에는 두 provider의 계약이 같은 것만 둔다. 포트별 매핑은 각 provider 파일에 남긴다.

export const TAB_ID = "t1";
/** 스냅샷 ref 상한(`BrowseSnapshot.refs`의 maxItems) */
export const MAX_REFS = 4000;
/** 도구·엔진 실패 문구를 오류 메시지에 싣는 길이 */
export const MAX_FAILURE_TEXT = 500;
export const MAX_TITLE = 512;
export const MAX_ROLE = 64;
export const MAX_NAME = 256;
export const MAX_URL = 2048;
/** 스크롤 한 번이 누르는 키 수(또는 한 번의 이동량)의 상한. `amount`가 이보다 커도 이만큼만 쓴다 */
export const MAX_SCROLL_PRESSES = 20;
export const DEFAULT_WAIT_MS = 1000;

const MAX_SCREENSHOT_DATA = 2_000_000;
const REF_MARK = /\[ref=(e\d{1,6})\]/;
/** 폼을 제출할 수 있는 요소의 역할. 교차 출처 폼 확인은 이 역할에만 묻는다 */
export const FORM_ROLES: ReadonlySet<string> = new Set([
  "button",
  "textbox",
  "searchbox",
  "combobox",
  "checkbox",
  "radio",
]);

const ScreenshotSchema: TObject<{
  mediaType: TUnion<[TLiteral<"image/png">, TLiteral<"image/jpeg">]>;
  data: TString;
  width: TInteger;
  height: TInteger;
}> = Type.Object({
  mediaType: Type.Union([Type.Literal("image/png"), Type.Literal("image/jpeg")]),
  data: Type.String({ maxLength: MAX_SCREENSHOT_DATA }),
  width: Type.Integer({ minimum: 1 }),
  height: Type.Integer({ minimum: 1 }),
});
export type Screenshot = Static<typeof ScreenshotSchema>;

export function clip(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max);
}

export function neverAborted(): AbortSignal {
  return new AbortController().signal;
}

/** 제공자 오류 값. `retryable`은 호출 쪽이 다시 시도해도 되는지다 */
export function providerError(code: string, retryable: boolean, message: string): CapabilityError {
  return new CapabilityError({
    capability: WebBrowse.id,
    method: "browse",
    code,
    message,
    retryable,
  });
}

export function invalidInput(message: string): CapabilityError {
  return providerError("invalid_input", false, message);
}

/** PNG나 JPEG이고 크기 상한 안인 스크린샷 값이면 그 값을, 아니면 `undefined`다 */
export function checkedScreenshot(input: unknown): Screenshot | undefined {
  const shot = parse(ScreenshotSchema, input);
  return shot.ok ? shot.value : undefined;
}

/** `find`: 질의가 역할이나 이름에 든(대소문자 무시) ref의 줄만 남긴다 */
export function linesOfMatches(snapshot: BrowseSnapshot, query: string): string {
  const needle = query.toLowerCase();
  const hits = new Set(
    snapshot.refs
      .filter(
        (entry) =>
          entry.role.toLowerCase().includes(needle) ||
          (entry.name ?? "").toLowerCase().includes(needle),
      )
      .map((entry) => entry.ref),
  );
  return snapshot.text
    .split("\n")
    .filter((line) => {
      const ref = REF_MARK.exec(line)?.[1];
      return ref !== undefined && hits.has(ref);
    })
    .join("\n");
}
