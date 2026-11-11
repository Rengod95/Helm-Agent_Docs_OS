import { expect, test } from "bun:test";
import { generateKeyPairSync, X509Certificate } from "node:crypto";
import { err, ok } from "@fresnel/contracts";
import type { SettingReader } from "../src/assembly/settings-sources.ts";
import type { SettingsStorePort } from "../src/types.ts";
import {
  loopbackOnlyPlan,
  proxyExampleOf,
  readGatewaySettings,
  validateGatewaySettings,
  writeGatewaySettings,
  type GatewayFiles,
  type GatewaySettingsIssue,
  type GatewaySettingsView,
  type ProxyKind,
  type SettingWriter,
} from "../src/service/gateway-settings.ts";

// L4.remote.spec §10, §8.2. 게이트웨이 설정 다섯 키의 읽기, 검사, 쓰기, 프록시 예시를 값으로 비교한다.
// 인증서는 `openssl req -x509 -newkey ec -days 1`로 만든 일회용 자체 서명의 공개 PEM이다. 키는 시험 안에서 만든다.

const CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIBUTCB+KADAgECAhQFg2iOMUkZ4oE4nerhztoIxClvlzAKBggqhkjOPQQDAjAP
MQ0wCwYDVQQDDAR0ZXN0MB4XDTI2MTExMTE5MzcwNFoXDTI2MTExMjE5MzcwNFow
DzENMAsGA1UEAwwEdGVzdDBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABOVpbwp3
MykeOCDX2gjYoktwEMaZ4C5fVhFpl72GxABsDD7n2jcwMsuKCMAM8X2R+X9hlruV
w/X99JayT3anDOOjMjAwMB0GA1UdDgQWBBRqcpKn4jxAePep6XFdU9DnXGUZ+jAP
BgNVHRMBAf8EBTADAQH/MAoGCCqGSM49BAMCA0gAMEUCIQC80RU53F7tm8Qbz3p9
6p2Quv8yL2NHsAcn9i4WLuLZQAIgKmZoHfdHuelsCk/Q62jRGvUs8Og4iVk38yTr
KZfMCmA=
-----END CERTIFICATE-----
`;

/** 인증서와 짝이 아닌 키(시험용, 메모리에만 있다) */
const OTHER_KEY_PEM: string = generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
}).privateKey;

const CERT_NOT_AFTER = Date.parse(new X509Certificate(CERT_PEM).validTo);
const BEFORE_EXPIRY = CERT_NOT_AFTER - 60_000;
const AFTER_EXPIRY = CERT_NOT_AFTER + 1;

const CLEAN: GatewaySettingsView = {
  listen: "127.0.0.1:8480",
  listenTls: null,
  hosts: [],
  tlsCert: null,
  tlsKey: null,
};
const EXTERNAL: GatewaySettingsView = {
  ...CLEAN,
  listenTls: "0.0.0.0:8443",
  hosts: ["fresnel.example.com"],
};

/** 컴파일 시점 검사: 실제 설정 포트가 `SettingWriter` 모양이어야 `lifetime.ts`의 `engine.ports.settings`를 이 함수에 넘길 수 있다 */
const asWriter = (port: SettingsStorePort): SettingWriter => port;

function readerOf(values: Readonly<Record<string, unknown>>): SettingReader {
  return (key) => values[key];
}

function filesOf(contents: Readonly<Record<string, string>>): GatewayFiles {
  return { readFile: (path) => contents[path] ?? null };
}

/** 읽은 경로를 모두 적는 파일 읽기(읽지 않아야 하는 경우를 시험한다) */
function recordingFilesOf(contents: Readonly<Record<string, string>>): {
  files: GatewayFiles;
  reads: string[];
} {
  const reads: string[] = [];
  return {
    reads,
    files: {
      readFile: (path) => {
        reads.push(path);
        return contents[path] ?? null;
      },
    },
  };
}

interface Call {
  readonly scope: string;
  readonly key: string;
  readonly value: unknown;
  readonly thread: undefined;
}

/** 호출 목록을 모으는 가짜 쓰기. `failKey`의 쓰기만 실패한다 */
function recordingWriter(failKey?: string): { writer: SettingWriter; calls: Call[] } {
  const calls: Call[] = [];
  const writer: SettingWriter = {
    async write(scope, key, value, thread) {
      calls.push({ scope, key, value, thread });
      return key === failKey ? err({ kind: "file_unwritable" }) : ok(undefined);
    },
  };
  return { writer, calls };
}

test("reading: empty text is no value and a missing host list is empty", () => {
  expect(readGatewaySettings(readerOf({}))).toEqual({
    listen: "",
    listenTls: null,
    hosts: [],
    tlsCert: null,
    tlsKey: null,
  });
  expect(
    readGatewaySettings(
      readerOf({
        "l4.remote.web.listen": "127.0.0.1:8480",
        "l4.remote.web.listenTls": "",
        "l4.remote.web.hosts": [],
        "l4.remote.web.tlsCert": "",
        "l4.remote.web.tlsKey": "",
      }),
    ),
  ).toEqual(CLEAN);
});

test("reading: set values pass through and non-string host entries are dropped", () => {
  expect(
    readGatewaySettings(
      readerOf({
        "l4.remote.web.listen": "127.0.0.1:9000",
        "l4.remote.web.listenTls": "0.0.0.0:8443",
        "l4.remote.web.hosts": ["fresnel.example.com", 3, "other.example"],
        "l4.remote.web.tlsCert": "/etc/fresnel/cert.pem",
        "l4.remote.web.tlsKey": "/etc/fresnel/key.pem",
      }),
    ),
  ).toEqual({
    listen: "127.0.0.1:9000",
    listenTls: "0.0.0.0:8443",
    hosts: ["fresnel.example.com", "other.example"],
    tlsCert: "/etc/fresnel/cert.pem",
    tlsKey: "/etc/fresnel/key.pem",
  });
  expect(
    readGatewaySettings(
      readerOf({
        "l4.remote.web.listen": 8480,
        "l4.remote.web.listenTls": 8443,
        "l4.remote.web.hosts": "fresnel.example.com",
        "l4.remote.web.tlsCert": null,
        "l4.remote.web.tlsKey": true,
      }),
    ),
  ).toEqual({ listen: "", listenTls: null, hosts: [], tlsCert: null, tlsKey: null });
});

test("validation: clean views have no issues, and an empty listen is the gateway default", () => {
  expect(validateGatewaySettings(CLEAN, filesOf({}), BEFORE_EXPIRY)).toEqual([]);
  expect(validateGatewaySettings(EXTERNAL, filesOf({}), BEFORE_EXPIRY)).toEqual([]);
  expect(validateGatewaySettings({ ...CLEAN, listen: "" })).toEqual([]);
});

/** `listen`만 바꾼 설정의 검사 결과 */
const listenIssuesOf = (listen: string): readonly GatewaySettingsIssue[] =>
  validateGatewaySettings({ ...CLEAN, listen });
/** `listenTls`만 바꾼 설정의 검사 결과 */
const listenTlsIssuesOf = (listenTls: string): readonly GatewaySettingsIssue[] =>
  validateGatewaySettings({ ...EXTERNAL, listenTls });
/** `hosts`만 바꾼 설정의 검사 결과 */
const hostIssuesOf = (hosts: readonly string[]): readonly GatewaySettingsIssue[] =>
  validateGatewaySettings({ ...EXTERNAL, hosts });

test("validation: listen must be a loopback address with a port in range", () => {
  expect(listenIssuesOf("0.0.0.0:8480")).toEqual([
    { field: "listen", code: "listen_not_loopback" },
  ]);
  expect(listenIssuesOf("[::1]:8480")).toEqual([{ field: "listen", code: "listen_not_loopback" }]);
  expect(listenIssuesOf("8480")).toEqual([{ field: "listen", code: "listen_bad_format" }]);
  expect(listenIssuesOf("127.0.0.1")).toEqual([{ field: "listen", code: "listen_bad_format" }]);
  expect(listenIssuesOf("127.0.0.1:0")).toEqual([{ field: "listen", code: "port_out_of_range" }]);
  expect(listenIssuesOf("127.0.0.1:65536")).toEqual([
    { field: "listen", code: "port_out_of_range" },
  ]);
  expect(listenIssuesOf("localhost:1")).toEqual([]);
  expect(listenIssuesOf("127.0.0.1:65535")).toEqual([]);
});

test("validation: listenTls must be host:port with a port in range", () => {
  expect(listenTlsIssuesOf("0.0.0.0")).toEqual([
    { field: "listenTls", code: "listen_tls_bad_format" },
  ]);
  expect(listenTlsIssuesOf("0.0.0.0:99999")).toEqual([
    { field: "listenTls", code: "port_out_of_range" },
  ]);
  expect(listenTlsIssuesOf("[::]:8443")).toEqual([]);
  expect(listenTlsIssuesOf("192.168.0.7:9443")).toEqual([]);
});

test("validation: host names must be host names and at most 64 are kept", () => {
  expect(hostIssuesOf(["bad name", "a/b", "fresnel.example.com:443", ""])).toEqual([
    { field: "hosts", code: "host_bad_name" },
  ]);
  const sixtyFour = Array.from({ length: 64 }, (_, index) => `h${index}.example.com`);
  expect(hostIssuesOf(sixtyFour)).toEqual([]);
  expect(hostIssuesOf([...sixtyFour, "extra.example.com"])).toEqual([
    { field: "hosts", code: "hosts_too_many" },
  ]);
});

test("validation: a wildcard listenTls with no hosts is accepted, since the service fills local names", () => {
  expect(validateGatewaySettings({ ...CLEAN, listenTls: "0.0.0.0:8443", hosts: [] })).toEqual([]);
});

test("validation: a certificate without a key, or a key without a certificate", () => {
  expect(
    validateGatewaySettings({ ...EXTERNAL, tlsCert: "/x/cert.pem", tlsKey: null }, filesOf({})),
  ).toEqual([{ field: "tlsKey", code: "tls_cert_without_key" }]);
  expect(
    validateGatewaySettings({ ...EXTERNAL, tlsCert: null, tlsKey: "/x/key.pem" }, filesOf({})),
  ).toEqual([{ field: "tlsCert", code: "tls_key_without_cert" }]);
});

test("validation: TLS files are not checked while the external listener is off", () => {
  const { files, reads } = recordingFilesOf({});
  expect(
    validateGatewaySettings(
      { ...CLEAN, listenTls: null, tlsCert: "cert.pem", tlsKey: null },
      files,
      BEFORE_EXPIRY,
    ),
  ).toEqual([]);
  expect(reads).toEqual([]);
});

test("validation: a relative certificate or key path is refused and not read", () => {
  const { files, reads } = recordingFilesOf({});
  expect(
    validateGatewaySettings(
      { ...EXTERNAL, tlsCert: "cert.pem", tlsKey: "key.pem" },
      files,
      BEFORE_EXPIRY,
    ),
  ).toEqual([
    { field: "tlsCert", code: "tls_cert_not_absolute" },
    { field: "tlsKey", code: "tls_key_not_absolute" },
  ]);
  expect(reads).toEqual([]);
});

test("validation: unreadable certificate and key files", () => {
  expect(
    validateGatewaySettings(
      { ...EXTERNAL, tlsCert: "/x/cert.pem", tlsKey: "/x/key.pem" },
      filesOf({}),
      BEFORE_EXPIRY,
    ),
  ).toEqual([
    { field: "tlsCert", code: "tls_cert_unreadable" },
    { field: "tlsKey", code: "tls_key_unreadable" },
  ]);
});

test("validation: a certificate or key that does not parse", () => {
  const paths = { ...EXTERNAL, tlsCert: "/x/cert.pem", tlsKey: "/x/key.pem" };
  expect(
    validateGatewaySettings(
      paths,
      filesOf({ "/x/cert.pem": "not a certificate", "/x/key.pem": OTHER_KEY_PEM }),
      BEFORE_EXPIRY,
    ),
  ).toEqual([{ field: "tlsCert", code: "tls_cert_invalid" }]);
  expect(
    validateGatewaySettings(
      paths,
      filesOf({ "/x/cert.pem": CERT_PEM, "/x/key.pem": "not a key" }),
      BEFORE_EXPIRY,
    ),
  ).toEqual([{ field: "tlsKey", code: "tls_key_invalid" }]);
});

test("validation: a key that does not belong to the certificate", () => {
  expect(
    validateGatewaySettings(
      { ...EXTERNAL, tlsCert: "/x/cert.pem", tlsKey: "/x/key.pem" },
      filesOf({ "/x/cert.pem": CERT_PEM, "/x/key.pem": OTHER_KEY_PEM }),
      BEFORE_EXPIRY,
    ),
  ).toEqual([{ field: "tlsKey", code: "tls_key_mismatch" }]);
});

test("validation: an expired certificate is reported at the time given", () => {
  expect(
    validateGatewaySettings(
      { ...EXTERNAL, tlsCert: "/x/cert.pem", tlsKey: "/x/key.pem" },
      filesOf({ "/x/cert.pem": CERT_PEM, "/x/key.pem": OTHER_KEY_PEM }),
      AFTER_EXPIRY,
    ),
  ).toEqual([
    { field: "tlsCert", code: "tls_cert_expired" },
    { field: "tlsKey", code: "tls_key_mismatch" },
  ]);
});

test("writing: only the changed keys are written, in field order", async () => {
  const { writer, calls } = recordingWriter();
  const result = await writeGatewaySettings(
    writer,
    { listen: "127.0.0.1:9000", hosts: ["fresnel.example.com"] },
    CLEAN,
  );
  expect(calls).toEqual([
    { scope: "user", key: "l4.remote.web.listen", value: "127.0.0.1:9000", thread: undefined },
    {
      scope: "user",
      key: "l4.remote.web.hosts",
      value: ["fresnel.example.com"],
      thread: undefined,
    },
  ]);
  expect(result).toEqual(
    ok({ ...CLEAN, listen: "127.0.0.1:9000", hosts: ["fresnel.example.com"] }),
  );
});

test("writing: the loopback-only plan writes both listeners and the host list", async () => {
  const { writer, calls } = recordingWriter();
  const plan = loopbackOnlyPlan(8480, 8443, "fresnel.example.com");
  const result = await writeGatewaySettings(writer, plan, CLEAN);
  expect(result.ok).toBe(true);
  expect(calls.map((call) => [call.key, call.value])).toEqual([
    ["l4.remote.web.listenTls", "127.0.0.1:8443"],
    ["l4.remote.web.hosts", ["fresnel.example.com"]],
  ]);
  expect(result).toEqual(ok({ ...CLEAN, ...plan }));
});

test("writing: an invalid result writes nothing", async () => {
  const { writer, calls } = recordingWriter();
  const result = await writeGatewaySettings(writer, { listen: "0.0.0.0:8480" }, CLEAN);
  expect(calls).toEqual([]);
  expect(result).toEqual(
    err({ kind: "invalid", issues: [{ field: "listen", code: "listen_not_loopback" }] }),
  );
});

test("writing: an unchanged value writes nothing", async () => {
  const { writer, calls } = recordingWriter();
  const result = await writeGatewaySettings(writer, { listen: "127.0.0.1:8480" }, CLEAN);
  expect(calls).toEqual([]);
  expect(result).toEqual(ok(CLEAN));
});

test("writing: a failed store write reports store_failed", async () => {
  const { writer, calls } = recordingWriter("l4.remote.web.hosts");
  const result = await writeGatewaySettings(
    writer,
    { listen: "127.0.0.1:9000", hosts: ["fresnel.example.com"] },
    CLEAN,
  );
  expect(calls.map((call) => call.key)).toEqual(["l4.remote.web.listen", "l4.remote.web.hosts"]);
  expect(result).toEqual(err({ kind: "store_failed" }));
});

test("the real settings store port has the SettingWriter shape", () => {
  expect(typeof asWriter).toBe("function");
});

test("proxy: the Caddy example is filled with the domain and the loopback port", () => {
  expect(proxyExampleOf({ kind: "caddy", domain: "fresnel.example.com", tlsPort: 8480 })).toEqual(
    ok(`# The Fresnel gateway listens only on 127.0.0.1:8480 (TLS, l4.remote.web.listenTls). This proxy handles external HTTPS.
# Add fresnel.example.com to l4.remote.web.hosts: the gateway's TLS listener checks the Host header and the Origin against it.
# The gateway's own certificate is self-signed, so Caddy skips verifying it on this local hop. Caddy adds the WebSocket upgrade headers itself.
fresnel.example.com {
  reverse_proxy https://127.0.0.1:8480 {
    transport http {
      tls_insecure_skip_verify
    }
  }
}
`),
  );
});

test("proxy: the nginx example is filled with the domain and the loopback port", () => {
  expect(proxyExampleOf({ kind: "nginx", domain: "fresnel.example.com", tlsPort: 8480 })).toEqual(
    ok(`# The Fresnel gateway listens only on 127.0.0.1:8480 (TLS, l4.remote.web.listenTls). This proxy handles external HTTPS.
# Add fresnel.example.com to l4.remote.web.hosts: the gateway's TLS listener checks the Host header and the Origin against it.
# The gateway's own certificate is self-signed, so nginx skips verifying it on this local hop.
server {
  listen 443 ssl;
  server_name fresnel.example.com;
  ssl_certificate /etc/letsencrypt/live/fresnel.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/fresnel.example.com/privkey.pem;

  location / {
    proxy_pass https://127.0.0.1:8480;
    proxy_ssl_verify off;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 3600s;
  }
}

server {
  listen 80;
  server_name fresnel.example.com;
  return 301 https://$host$request_uri;
}
`),
  );
});

const PROXY_KINDS: readonly ProxyKind[] = ["caddy", "nginx"];

test("proxy: a domain with spaces, slashes, colons or config characters is refused", () => {
  for (const kind of PROXY_KINDS) {
    for (const domain of [
      "",
      "fresnel example.com",
      "fresnel.example.com/x",
      "fresnel.example.com:443",
      "fresnel.example.com; deny all",
      "fresnel.example.com {",
      ".example.com",
      "example.com.",
    ]) {
      expect(proxyExampleOf({ kind, domain, tlsPort: 8480 })).toEqual(
        err({ kind: "invalid_domain" }),
      );
    }
  }
});

test("proxy: a port outside 1 to 65535 is refused", () => {
  for (const kind of PROXY_KINDS) {
    for (const tlsPort of [0, 65_536, 8480.5]) {
      expect(proxyExampleOf({ kind, domain: "fresnel.example.com", tlsPort })).toEqual(
        err({ kind: "invalid_port" }),
      );
    }
  }
});

test("proxy: the loopback-only plan binds both listeners to 127.0.0.1 and lists the domain", () => {
  expect(loopbackOnlyPlan(8480, 8443, "fresnel.example.com")).toEqual({
    listen: "127.0.0.1:8480",
    listenTls: "127.0.0.1:8443",
    hosts: ["fresnel.example.com"],
  });
});
