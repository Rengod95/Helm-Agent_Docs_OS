import { err, ok, type Result } from "@xeon/contracts";

// ADR-0020 §3.3, L4.host-service.spec §3.3.4. 원격 서비스 접속 주소의 값과 문자열 문법. 순수 함수만 있어 브라우저 번들에도 들어갈 수 있다
// (Node API는 `./socket`에 있다). 문자열은 설정 키 `l0.process.service.remote`와 CLI 플래그 `--remote`가 같은 문법으로 쓴다.
//
//   unix:/abs/path                          로컬 서비스 Unix 소켓(절대 경로만 `/abs/path`로 써도 된다)
//   tcp://host:port                         사설망 TCP. 토큰이 필요하다(환경 변수 XEON_REMOTE_TOKEN). 호스트는 이름, IPv4, [IPv6]
//   ssh://[user@]host[:port]/abs/socket     SSH 터널로 원격 서비스 Unix 소켓에 접속

export type ServiceEndpoint =
  | { readonly kind: "unix"; readonly path: string }
  | { readonly kind: "tcp"; readonly host: string; readonly port: number; readonly token?: string }
  | {
      readonly kind: "ssh";
      /** `[user@]host`. 선택지로 읽히지 않는 문자만 쓴다 */
      readonly target: string;
      readonly remoteSocket: string;
      readonly port?: number;
    };

export type EndpointParseError =
  | { readonly kind: "empty" }
  | { readonly kind: "unknown_scheme" }
  | { readonly kind: "invalid"; readonly part: "host" | "port" | "path" | "target" };

/** 절대 경로, 공백·`:`·제어 문자 없음. `ssh -L`이 `:`로 필드를 나누므로 Unix 경로에도 같은 제한을 둔다 */
function isSocketPath(path: string): boolean {
  return (
    /^\/[^\s:]*$/.test(path) &&
    !Array.from(path).some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f)
  );
}

function portOf(text: string): number | undefined {
  if (!/^\d{1,5}$/.test(text)) return undefined;
  const port = Number(text);
  return port >= 1 && port <= 65_535 ? port : undefined;
}

const TARGET_HOST = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;
const TARGET_USER = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;
const TCP_HOST = /^(?:[A-Za-z0-9][A-Za-z0-9.-]*|\[[0-9A-Fa-f:.]+\])$/;

function parseTcp(rest: string): Result<ServiceEndpoint, EndpointParseError> {
  const match = /^(\[[^\]]*\]|[^:/]*):(\d+)$/.exec(rest);
  if (match === null) return err({ kind: "invalid", part: "host" });
  const [, hostText = "", portText = ""] = match;
  if (!TCP_HOST.test(hostText)) return err({ kind: "invalid", part: "host" });
  const port = portOf(portText);
  if (port === undefined) return err({ kind: "invalid", part: "port" });
  // net.connect는 괄호 없는 IPv6 주소를 받는다
  const host = hostText.startsWith("[") ? hostText.slice(1, -1) : hostText;
  return ok({ kind: "tcp", host, port });
}

function parseSsh(rest: string): Result<ServiceEndpoint, EndpointParseError> {
  const slash = rest.indexOf("/");
  if (slash < 0) return err({ kind: "invalid", part: "path" });
  const authority = rest.slice(0, slash);
  const path = rest.slice(slash);
  if (!isSocketPath(path)) return err({ kind: "invalid", part: "path" });
  const at = authority.lastIndexOf("@");
  const user = at < 0 ? undefined : authority.slice(0, at);
  const hostPort = at < 0 ? authority : authority.slice(at + 1);
  const colon = hostPort.lastIndexOf(":");
  const host = colon < 0 ? hostPort : hostPort.slice(0, colon);
  const portText = colon < 0 ? undefined : hostPort.slice(colon + 1);
  if (!TARGET_HOST.test(host)) return err({ kind: "invalid", part: "target" });
  if (user !== undefined && !TARGET_USER.test(user)) {
    return err({ kind: "invalid", part: "target" });
  }
  const port = portText === undefined ? undefined : portOf(portText);
  if (portText !== undefined && port === undefined) return err({ kind: "invalid", part: "port" });
  return ok({
    kind: "ssh",
    target: user === undefined ? host : `${user}@${host}`,
    remoteSocket: path,
    ...(port === undefined ? {} : { port }),
  });
}

export function parseServiceEndpoint(text: string): Result<ServiceEndpoint, EndpointParseError> {
  const trimmed = text.trim();
  if (trimmed === "") return err({ kind: "empty" });
  if (trimmed.startsWith("/")) {
    return isSocketPath(trimmed)
      ? ok({ kind: "unix", path: trimmed })
      : err({ kind: "invalid", part: "path" });
  }
  if (trimmed.startsWith("unix:")) {
    const path = trimmed.slice("unix:".length);
    return isSocketPath(path) ? ok({ kind: "unix", path }) : err({ kind: "invalid", part: "path" });
  }
  if (trimmed.startsWith("tcp://")) return parseTcp(trimmed.slice("tcp://".length));
  if (trimmed.startsWith("ssh://")) return parseSsh(trimmed.slice("ssh://".length));
  return err({ kind: "unknown_scheme" });
}
