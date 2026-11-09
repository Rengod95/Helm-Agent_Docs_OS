// 모든 응답에 붙이는 보안 헤더(spec §8.5). CORS 헤더는 내지 않는다.

/** HTTPS에서는 HSTS를 더한다(자체 서명 인증서에서도 같다). 루프백 HTTP에는 붙이지 않는다 */
export function securityHeaders(options: {
  readonly tls: boolean;
}): Readonly<Record<string, string>> {
  const base: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
  if (options.tls) base["Strict-Transport-Security"] = "max-age=31536000";
  return base;
}
