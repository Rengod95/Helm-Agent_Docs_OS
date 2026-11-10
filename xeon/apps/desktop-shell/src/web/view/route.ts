// `GET|HEAD /view/<권한토큰>/<확장>/<버전>/<경로>`(L4.remote.spec §6.3). 쿠키 없이 경로의 토큰으로만 인증한다.
// 파일 규칙(확장 이름과 버전 마디 검사, app root 밖 차단, 퍼센트 디코딩 한 번, 허용 확장자, 크기)과 프레임 CSP는
// `src/main/view-scheme.ts`의 것을 그대로 쓴다. 바뀌는 것은 주소 접두(`{base}`)뿐이다.
import { securityHeaders } from "../auth/headers.ts";
import { respondWithBase } from "../../main/view-scheme.ts";
import type { ViewTokens } from "./tokens.ts";

export const VIEW_PREFIX = "/view/";

/** 경로를 `(토큰, 데스크톱 주소 모양)`으로 푼다. 모양이 틀리면 `undefined`다 */
function parseViewPath(
  pathname: string,
): { readonly token: string; readonly uri: string } | undefined {
  if (!pathname.startsWith(VIEW_PREFIX)) return undefined;
  const rest = pathname.slice(VIEW_PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return undefined;
  return {
    token: rest.slice(0, slash),
    // 이후 규칙은 `fresnel-view://<확장>/<버전>/<경로>`에 정의돼 있다. 같은 글자 규칙을 재사용한다
    uri: `fresnel-view://${rest.slice(slash + 1)}`,
  };
}

export interface ViewRequest {
  readonly method: string;
  readonly pathname: string;
  /** 질의 문자열(`?`를 포함, 없으면 빈 글). 프레임 주소는 질의를 받지 않는다 */
  readonly search: string;
  readonly tls: boolean;
  /** 검사를 통과한 `Host` 헤더 값(포트 포함) */
  readonly host: string;
}

/** CSP 목록 문법을 깨는 글자(공백, `;`, `,`, `'`) 없이 `/`로 끝나는 주소 */
const SAFE_BASE = /^https?:\/\/[^\s;,']+\/$/;

function bare(tls: boolean, status: number): Response {
  const headers = new Headers(securityHeaders({ tls }));
  headers.set("Cache-Control", "no-store");
  return new Response(null, { status, headers });
}

/**
 * 프레임 파일 하나를 답한다. 토큰이 없거나 모르거나 만료됐으면 401, 주소 모양이 틀리면 400이다.
 * 그 밖의 거절은 `view-scheme.ts`의 상태 코드(403, 404, 405, 413)를 그대로 쓴다. 이유 글은 싣지 않는다.
 */
export async function respondView(tokens: ViewTokens, request: ViewRequest): Promise<Response> {
  const { tls } = request;
  if (request.method !== "GET" && request.method !== "HEAD") return bare(tls, 405);
  const parsed = parseViewPath(request.pathname);
  if (parsed === undefined || request.search !== "") return bare(tls, 400);
  const roots = tokens.lookup(parsed.token);
  if (roots === undefined) return bare(tls, 401);
  const origin = `${tls ? "https" : "http"}://${request.host}`;
  if (!SAFE_BASE.test(`${origin}${VIEW_PREFIX}${parsed.token}/`)) return bare(tls, 400);
  const answered = await respondWithBase(roots, request.method, parsed.uri, (frame) => {
    return `${origin}${VIEW_PREFIX}${parsed.token}/${frame.extension}/${frame.version}/`;
  });
  if (answered.status !== 200) return bare(tls, answered.status);
  const headers = new Headers(answered.headers);
  for (const [name, value] of Object.entries(securityHeaders({ tls }))) {
    if (!headers.has(name)) headers.set(name, value);
  }
  // 프레임은 sandbox라 출처가 불투명하다. 하위 자원은 다른 출처의 요청이므로 같은 출처 한정 정책을 풀어야 한다.
  // 이 주소는 토큰 없이는 열리지 않고 응답에 쿠키도 없다
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  return new Response(answered.body, { status: 200, headers });
}
