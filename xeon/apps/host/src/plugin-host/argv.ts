// 플러그인 호스트 하위 명령(`plugin-host --stdio`)의 인자 해석. 이 파일은 가볍게 유지한다: 진입 파일(main.ts)이 엔진을 싣기 전에 부른다.
// 인자는 정확히 `--stdio` 하나뿐이다. 그 밖의 인자는 사용 오류다(L4.host-service.spec §3.2).

export type PluginHostArgv =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

export function parsePluginHostArgv(rest: readonly string[]): PluginHostArgv {
  const [first, ...extra] = rest;
  if (first !== "--stdio") {
    return { ok: false, message: "usage: plugin-host --stdio" };
  }
  const [unknown] = extra;
  if (unknown !== undefined) {
    return { ok: false, message: `unknown argument: ${unknown}` };
  }
  return { ok: true };
}
