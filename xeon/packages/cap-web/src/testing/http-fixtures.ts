import { err, ok } from "@xeon/contracts";
import type { DnsResolver } from "../ports/resolver.ts";
import type {
  HttpTransport,
  TransportFailure,
  TransportRequest,
  TransportResponse,
} from "../ports/transport.ts";
import { addressVerdict } from "../policy/ssrf.ts";

// 녹화 HTTP 픽스처를 재생하는 전송(L2.web.plan §2 testing/http-fixtures.ts). 네트워크를 쓰지 않는다.
// public 모드는 연결 시점에 호스트를 한 번 더 풀어 주소를 다시 검사한다(운영 전송의 연결 시점 재검증을 흉내 낸다).

interface FixtureResponse {
  readonly status?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string | Uint8Array;
  readonly failure?: TransportFailure;
}

export type FixtureRoute = FixtureResponse | ((request: TransportRequest) => FixtureResponse);

export interface FixtureTransport extends HttpTransport {
  /** 받은 요청 기록. 연결 시점 검사에서 거부된 요청도 포함한다 */
  readonly requests: TransportRequest[];
  /** 연결 시도까지 간 요청 수(연결 시점 검사에서 거부된 요청은 뺀다) */
  readonly connections: () => number;
  /** `GET <url>` 같은 키가 아니라 메서드 없이 URL로 라우트를 단다. 같은 URL을 다시 달면 덮어쓴다 */
  route(url: string, response: FixtureRoute): void;
}

function encode(body: string | Uint8Array | undefined): Uint8Array {
  if (body === undefined) return new Uint8Array(0);
  return typeof body === "string" ? new TextEncoder().encode(body) : body;
}

function lowerCase(headers: Readonly<Record<string, string>> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) out[name.toLowerCase()] = value;
  return out;
}

export function fixtureTransport(
  routes: Readonly<Record<string, FixtureRoute>> = {},
  connectResolver?: DnsResolver,
): FixtureTransport {
  const table = new Map<string, FixtureRoute>(Object.entries(routes));
  const requests: TransportRequest[] = [];
  let connected = 0;
  return {
    requests,
    connections: () => connected,
    route(url, response) {
      table.set(url, response);
    },
    async send(request) {
      requests.push(request);
      if (request.mode === "public" && connectResolver !== undefined) {
        const host = new URL(request.url).hostname.replace(/^\[|\]$/g, "");
        const resolved = await connectResolver.resolve(host, request.signal);
        if (resolved.ok) {
          for (const address of resolved.value) {
            const verdict = addressVerdict(address, {
              allowPrivateNetwork: false,
              localEndpoint: false,
            });
            if (!verdict.ok) {
              return err({
                kind: "blocked",
                message: `connect-time check refused ${address} for ${host}`,
              });
            }
          }
        }
      }
      connected += 1;
      const route = table.get(request.url);
      if (route === undefined) {
        return err({ kind: "network", message: `no fixture for ${request.url}` });
      }
      const fixture = typeof route === "function" ? route(request) : route;
      if (fixture.failure !== undefined) return err(fixture.failure);
      const body = encode(fixture.body);
      if (body.byteLength > request.maxBytes) {
        return err({ kind: "too_large", maxBytes: request.maxBytes });
      }
      const response: TransportResponse = {
        status: fixture.status ?? 200,
        url: request.url,
        headers: lowerCase(fixture.headers),
        body,
      };
      return ok(response);
    },
  };
}
