import type { JsonValue } from "@fresnel/contracts/conversation";

// 샌드박스가 막은 도구 호출의 화면 모양(L1.tools.spec §4.12.3). 엔진은 결과의 `details`에 `code`(sandbox.*)와 대상을 싣는다.
// 모델에 가는 글은 엔진이 따로 준다. 이 모델은 화면용 details만 읽는다.

export type SandboxBlockView =
  | { readonly code: "sandbox.network_blocked"; readonly domain: string }
  | { readonly code: "sandbox.write_blocked"; readonly path: string }
  | { readonly code: "sandbox.read_blocked"; readonly path: string };

const SANDBOX_CODES: ReadonlySet<string> = new Set([
  "sandbox.network_blocked",
  "sandbox.write_blocked",
  "sandbox.read_blocked",
]);

function isObject(value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 막은 것 한 건을 읽는다. 종류나 대상이 빠졌거나 모르는 종류면 null이다 */
function viewOf(value: JsonValue | undefined): SandboxBlockView | null {
  if (!isObject(value)) return null;
  const code = value["code"];
  if (code === "sandbox.network_blocked") {
    const domain = value["domain"];
    return typeof domain === "string" ? { code, domain } : null;
  }
  if (code === "sandbox.write_blocked") {
    const path = value["path"];
    return typeof path === "string" ? { code, path } : null;
  }
  if (code === "sandbox.read_blocked") {
    const path = value["path"];
    return typeof path === "string" ? { code, path } : null;
  }
  return null;
}

/**
 * 도구 결과의 details가 샌드박스가 막은 것을 알리면 막은 것들의 목록을 돌려준다. 아니면 빈 목록이다.
 * `blocks`가 없거나 쓸 것이 없으면 `details`의 `code`와 `domain`·`path` 한 건으로 읽는다.
 */
export function sandboxBlocksOf(details: JsonValue | undefined): readonly SandboxBlockView[] {
  if (!isObject(details)) return [];
  const code = details["code"];
  if (typeof code !== "string" || !SANDBOX_CODES.has(code)) return [];
  const listed = details["blocks"];
  if (Array.isArray(listed)) {
    const views = listed.flatMap((entry: JsonValue) => {
      const view = viewOf(entry);
      return view === null ? [] : [view];
    });
    if (views.length > 0) return views;
  }
  const single = viewOf(details);
  return single === null ? [] : [single];
}
