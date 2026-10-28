import { attempt, err, ok, type Result } from "@xeon/contracts";

// L2.web.spec §4.3.3. 키와 Source ID 비교에만 쓰는 순수 함수다. 요청은 정규화 전 URL로 보낸다.

export type UrlNormalizeError = { readonly kind: "invalid_url"; readonly cause: unknown };

const TRACKING_EXACT: ReadonlySet<string> = new Set([
  "gclid",
  "fbclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "_hsenc",
  "_hsmi",
  "yclid",
]);

function decodeName(name: string): string {
  const decoded = attempt(() => decodeURIComponent(name.replaceAll("+", " ")));
  return decoded.ok ? decoded.value : name;
}

function isTracking(decodedName: string): boolean {
  const lower = decodedName.toLowerCase();
  return lower.startsWith("utm_") || TRACKING_EXACT.has(lower);
}

function compareNames(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * 스킴과 호스트를 소문자로, IDN을 punycode로, 기본 포트와 프래그먼트를 지우고, 추적 파라미터를 지운 뒤 남은 쿼리 파라미터를
 * 이름 순으로 정렬한다(같은 이름은 원래 순서). 호스트 끝의 점도 지운다.
 */
export function normalizeUrl(raw: string): Result<string, UrlNormalizeError> {
  const parsed = attempt(() => new URL(raw));
  if (!parsed.ok) return err({ kind: "invalid_url", cause: parsed.error.cause });
  const url = parsed.value;
  const pairs = url.search
    .replace(/^\?/, "")
    .split("&")
    .filter((part) => part !== "")
    .map((part, index) => {
      const eq = part.indexOf("=");
      const name = decodeName(eq === -1 ? part : part.slice(0, eq));
      return { part, name, index };
    })
    .filter((pair) => !isTracking(pair.name))
    .toSorted((a, b) => compareNames(a.name, b.name) || a.index - b.index);
  const query = pairs.length === 0 ? "" : `?${pairs.map((pair) => pair.part).join("&")}`;
  const user =
    url.username === "" ? "" : `${url.username}${url.password === "" ? "" : `:${url.password}`}@`;
  const host = url.host.replace(/\.(?=$|:)/, "");
  return ok(`${url.protocol}//${user}${host}${url.pathname}${query}`);
}
