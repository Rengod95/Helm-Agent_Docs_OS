import { createPrivateKey, X509Certificate, type KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { attempt, err, ok, type Result } from "@fresnel/contracts";
import type { SettingReader } from "../assembly/settings-sources.ts";

// L4.remote.spec §10, §8.2. 게이트웨이 설정 다섯 키(`l4.remote.web.*`)를 읽고, 쓰기 전에 게이트웨이가 시작할 때와 같은 판단으로 검사하고,
// 공개 서버(VPS)용 리버스 프록시 설정 예시를 실제 값으로 만든다. 화면(wizard)과 CLI가 같은 함수를 쓴다.
// 검사 규칙의 출처: `main/args.ts`(모양, 루프백 `listen`, 인증서와 키의 짝, 절대 경로), `tls/store.ts`(인증서 파싱, 키 짝, 만료).
// 모든 주소로 연 외부 리스너의 `hosts`가 비어 있는 것은 오류가 아니다: 서비스(`gatewayConfigOf`)가 이 컴퓨터의 이름으로 채워 넘긴다(§10).
// 외부 리스너가 꺼져 있으면(`listenTls` 없음) 인증서 파일은 쓰이지 않으므로 파일 상태로 설정을 막지 않는다.

const KEY_OF: Readonly<Record<keyof GatewaySettingsView, string>> = {
  listen: "l4.remote.web.listen",
  listenTls: "l4.remote.web.listenTls",
  hosts: "l4.remote.web.hosts",
  tlsCert: "l4.remote.web.tlsCert",
  tlsKey: "l4.remote.web.tlsKey",
};

/** `main/args.ts`의 `--listen` 루프백 주소. 게이트웨이는 이 두 이름만 받는다 */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["127.0.0.1", "localhost"]);
/** 모든 주소로 여는 값(외부 리스너가 이 주소면 `hosts`가 받을 이름의 근거가 된다) */
const BIND = /^(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+):(\d{1,5})$/u;
const HOST_NAME = /^(?:\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)$/u;
const DNS_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/u;
const HOST_NAME_MAX = 253;
const HOSTS_MAX = 64;
const PORT_MAX = 65_535;

export interface GatewaySettingsView {
  listen: string;
  listenTls: string | null;
  hosts: readonly string[];
  tlsCert: string | null;
  tlsKey: string | null;
}

export type GatewaySettingsIssue = {
  readonly field: "listen" | "listenTls" | "hosts" | "tlsCert" | "tlsKey";
  readonly code: string;
};

/** 인증서와 키 파일을 읽는 자리. 읽지 못하면 `null`이다. 넘기지 않으면 실제 파일을 읽는다 */
export interface GatewayFiles {
  readFile(path: string): string | null;
}

/** 설정 쓰기 포트의 모양. 실제 `engine.ports.settings`(`SettingsStorePort.write`)가 구조적으로 맞는지 시험이 본다 */
export interface SettingWriter {
  write(
    scope: "user",
    key: string,
    value: unknown,
    thread: undefined,
  ): Promise<Result<unknown, { kind: string }>>;
}

export type GatewayWriteError =
  | { readonly kind: "invalid"; readonly issues: readonly GatewaySettingsIssue[] }
  | { readonly kind: "store_failed" };

export type ProxyKind = "caddy" | "nginx";

export interface ProxyExampleInput {
  kind: ProxyKind;
  domain: string;
  /** 게이트웨이 TLS 리스너가 루프백에서 듣는 포트(`l4.remote.web.listenTls = 127.0.0.1:<포트>`) */
  tlsPort: number;
}

export type ProxyExampleError = { readonly kind: "invalid_domain" | "invalid_port" };

const DEFAULT_FILES: GatewayFiles = {
  readFile(path) {
    const read = attempt(() => readFileSync(path, "utf8"));
    return read.ok ? read.value : null;
  },
};

/** 설정 값을 게이트웨이 설정으로 읽는다. 빈 문자열은 없음이다(`listen`은 빈 값이면 게이트웨이 기본 주소를 쓴다) */
export function readGatewaySettings(read: SettingReader): GatewaySettingsView {
  return {
    listen: textOf(read(KEY_OF.listen)),
    listenTls: nonEmptyOf(textOf(read(KEY_OF.listenTls))),
    hosts: stringsOf(read(KEY_OF.hosts)),
    tlsCert: nonEmptyOf(textOf(read(KEY_OF.tlsCert))),
    tlsKey: nonEmptyOf(textOf(read(KEY_OF.tlsKey))),
  };
}

/** 설정 전체를 검사한다. 빈 배열이면 게이트웨이가 이 설정으로 시작할 수 있다고 본다 */
export function validateGatewaySettings(
  view: GatewaySettingsView,
  files: GatewayFiles = DEFAULT_FILES,
  now: number = Date.now(),
): readonly GatewaySettingsIssue[] {
  return [
    ...listenIssues(view.listen),
    ...listenTlsIssues(view.listenTls),
    ...hostsIssues(view.hosts),
    ...tlsFileIssues(view, files, now),
  ];
}

/**
 * `current`에 `patch`를 덧씌운 값을 검사한다. 하나라도 있으면 아무것도 쓰지 않는다.
 * 통과하면 바뀐 키만 `user` 범위에 쓴다(`hosts`는 문자열 배열, 없음은 빈 문자열). 중간에 실패하면 앞서 쓴 키는 그대로 남는다.
 */
export async function writeGatewaySettings(
  write: SettingWriter,
  patch: Partial<GatewaySettingsView>,
  current: GatewaySettingsView,
  files: GatewayFiles = DEFAULT_FILES,
  now?: number,
): Promise<Result<GatewaySettingsView, GatewayWriteError>> {
  const next: GatewaySettingsView = { ...current, ...patch };
  const issues = validateGatewaySettings(next, files, now);
  if (issues.length > 0) return err({ kind: "invalid", issues });
  if (!(await writeInOrder(write, changesOf(current, next)))) return err({ kind: "store_failed" });
  return ok(next);
}

/** 앞에서부터 하나씩 쓴다. 순서가 있고(같은 설정 파일) 첫 실패에서 멈춘다. 모두 쓰면 참이다 */
async function writeInOrder(
  write: SettingWriter,
  changes: readonly SettingChange[],
): Promise<boolean> {
  const [first, ...rest] = changes;
  if (first === undefined) return true;
  const written = await write.write("user", first.key, first.value, undefined);
  return written.ok && (await writeInOrder(write, rest));
}

/** 프록시 설정 예시를 실제 도메인과 포트로 채운다. 도메인은 DNS 이름만 받는다(설정 파일에 다른 글자가 들어가지 않게 한다) */
export function proxyExampleOf(input: ProxyExampleInput): Result<string, ProxyExampleError> {
  if (!isDnsName(input.domain)) return err({ kind: "invalid_domain" });
  if (!portOk(input.tlsPort)) return err({ kind: "invalid_port" });
  const text =
    input.kind === "caddy"
      ? caddyExample(input.domain, input.tlsPort)
      : nginxExample(input.domain, input.tlsPort);
  return ok(text);
}

/**
 * 루프백에만 여는 구성: 외부 리스너를 끈다. 적용은 `writeGatewaySettings`가 한다.
 * `hosts`는 `existing`(지금 적은 허용 호스트)에 도메인을 더한 값이다: 적은 이름을 지우지 않는다. 중복은 뺀다.
 */
export function loopbackOnlyPlan(
  loopbackPort: number,
  tlsPort: number,
  domain: string,
  existing: readonly string[] = [],
): { listen: string; listenTls: string; hosts: readonly string[] } {
  return {
    listen: `127.0.0.1:${loopbackPort}`,
    listenTls: `127.0.0.1:${tlsPort}`,
    hosts: [...new Set([...existing, domain])],
  };
}

// ---- 검사 ----

type Loaded<T> =
  | { readonly kind: "ok"; readonly value: T }
  | { readonly kind: "failed"; readonly code: string };

function issue(field: GatewaySettingsIssue["field"], code: string): GatewaySettingsIssue {
  return { field, code };
}

function listenIssues(listen: string): readonly GatewaySettingsIssue[] {
  if (listen === "") return [];
  const bind = bindOf(listen);
  if (bind === null) return [issue("listen", "listen_bad_format")];
  if (!LOOPBACK_HOSTS.has(bind.host)) return [issue("listen", "listen_not_loopback")];
  return portOk(bind.port) ? [] : [issue("listen", "port_out_of_range")];
}

function listenTlsIssues(listenTls: string | null): readonly GatewaySettingsIssue[] {
  const text = nonEmptyOf(listenTls);
  if (text === null) return [];
  const bind = bindOf(text);
  if (bind === null) return [issue("listenTls", "listen_tls_bad_format")];
  return portOk(bind.port) ? [] : [issue("listenTls", "port_out_of_range")];
}

function hostsIssues(hosts: readonly string[]): readonly GatewaySettingsIssue[] {
  const issues: GatewaySettingsIssue[] = [];
  if (hosts.some((name) => !isHostName(name))) issues.push(issue("hosts", "host_bad_name"));
  if (hosts.length > HOSTS_MAX) issues.push(issue("hosts", "hosts_too_many"));
  return issues;
}

function tlsFileIssues(
  view: GatewaySettingsView,
  files: GatewayFiles,
  now: number,
): readonly GatewaySettingsIssue[] {
  if (absent(view.listenTls)) return [];
  const certPath = nonEmptyOf(view.tlsCert);
  const keyPath = nonEmptyOf(view.tlsKey);
  if (certPath === null && keyPath === null) return [];
  if (certPath === null) return [issue("tlsCert", "tls_key_without_cert")];
  if (keyPath === null) return [issue("tlsKey", "tls_cert_without_key")];
  return userTlsIssues(certPath, keyPath, files, now);
}

function userTlsIssues(
  certPath: string,
  keyPath: string,
  files: GatewayFiles,
  now: number,
): readonly GatewaySettingsIssue[] {
  const cert = certificateOf(certPath, files);
  const key = keyOf(keyPath, files);
  const issues: GatewaySettingsIssue[] = [];
  if (cert.kind === "failed") {
    issues.push(issue("tlsCert", cert.code));
  } else if (Date.parse(cert.value.validTo) <= now) {
    issues.push(issue("tlsCert", "tls_cert_expired"));
  }
  if (key.kind === "failed") issues.push(issue("tlsKey", key.code));
  if (cert.kind === "ok" && key.kind === "ok" && !pairs(cert.value, key.value)) {
    issues.push(issue("tlsKey", "tls_key_mismatch"));
  }
  return issues;
}

function certificateOf(path: string, files: GatewayFiles): Loaded<X509Certificate> {
  if (!isAbsolute(path)) return { kind: "failed", code: "tls_cert_not_absolute" };
  const text = files.readFile(path);
  if (text === null) return { kind: "failed", code: "tls_cert_unreadable" };
  const parsed = attempt(() => new X509Certificate(text));
  return parsed.ok
    ? { kind: "ok", value: parsed.value }
    : { kind: "failed", code: "tls_cert_invalid" };
}

function keyOf(path: string, files: GatewayFiles): Loaded<KeyObject> {
  if (!isAbsolute(path)) return { kind: "failed", code: "tls_key_not_absolute" };
  const text = files.readFile(path);
  if (text === null) return { kind: "failed", code: "tls_key_unreadable" };
  const parsed = attempt(() => createPrivateKey(text));
  return parsed.ok
    ? { kind: "ok", value: parsed.value }
    : { kind: "failed", code: "tls_key_invalid" };
}

/** 키가 인증서의 공개 키와 짝인가. 검사 자체가 던지면 짝이 아닌 것으로 본다 */
function pairs(cert: X509Certificate, key: KeyObject): boolean {
  const matched = attempt(() => cert.checkPrivateKey(key));
  return matched.ok && matched.value;
}

// ---- 쓰기 ----

interface SettingChange {
  readonly key: string;
  readonly value: string | string[];
}

function changesOf(
  current: GatewaySettingsView,
  next: GatewaySettingsView,
): readonly SettingChange[] {
  const changes: SettingChange[] = [];
  if (next.listen !== current.listen) changes.push({ key: KEY_OF.listen, value: next.listen });
  if (textOrEmpty(next.listenTls) !== textOrEmpty(current.listenTls)) {
    changes.push({ key: KEY_OF.listenTls, value: textOrEmpty(next.listenTls) });
  }
  if (!sameList(current.hosts, next.hosts))
    changes.push({ key: KEY_OF.hosts, value: [...next.hosts] });
  if (textOrEmpty(next.tlsCert) !== textOrEmpty(current.tlsCert)) {
    changes.push({ key: KEY_OF.tlsCert, value: textOrEmpty(next.tlsCert) });
  }
  if (textOrEmpty(next.tlsKey) !== textOrEmpty(current.tlsKey)) {
    changes.push({ key: KEY_OF.tlsKey, value: textOrEmpty(next.tlsKey) });
  }
  return changes;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

// ---- 프록시 예시 ----

function caddyExample(domain: string, port: number): string {
  return `# The Fresnel gateway listens only on 127.0.0.1:${port} (TLS, l4.remote.web.listenTls). This proxy handles external HTTPS.
# Add ${domain} to l4.remote.web.hosts: the gateway's TLS listener checks the Host header and the Origin against it.
# The gateway's own certificate is self-signed, so Caddy skips verifying it on this local hop. Caddy adds the WebSocket upgrade headers itself.
${domain} {
  reverse_proxy https://127.0.0.1:${port} {
    transport http {
      tls_insecure_skip_verify
    }
  }
}
`;
}

function nginxExample(domain: string, port: number): string {
  return `# The Fresnel gateway listens only on 127.0.0.1:${port} (TLS, l4.remote.web.listenTls). This proxy handles external HTTPS.
# Add ${domain} to l4.remote.web.hosts: the gateway's TLS listener checks the Host header and the Origin against it.
# The gateway's own certificate is self-signed, so nginx skips verifying it on this local hop.
server {
  listen 443 ssl;
  server_name ${domain};
  ssl_certificate /etc/letsencrypt/live/${domain}/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/${domain}/privkey.pem;

  location / {
    proxy_pass https://127.0.0.1:${port};
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
  server_name ${domain};
  return 301 https://$host$request_uri;
}
`;
}

// ---- 작은 도우미 ----

interface Bind {
  readonly host: string;
  readonly port: number;
}

/** `host:port`를 나눈다. IPv6는 `[addr]:port`이고 괄호를 뺀 주소를 돌려준다. 모양이 틀리면 null */
function bindOf(text: string): Bind | null {
  const match = BIND.exec(text);
  if (match === null) return null;
  const [, rawHost = "", digits = ""] = match;
  return { host: rawHost.replace(/^\[|\]$/gu, ""), port: Number(digits) };
}

function portOk(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= PORT_MAX;
}

function isHostName(name: string): boolean {
  return name.length >= 1 && name.length <= HOST_NAME_MAX && HOST_NAME.test(name);
}

function isDnsName(domain: string): boolean {
  if (domain.length > HOST_NAME_MAX) return false;
  return domain.split(".").every((label) => DNS_LABEL.test(label));
}

function absent(text: string | null): boolean {
  return text === null || text === "";
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function textOrEmpty(value: string | null): string {
  return value ?? "";
}

function nonEmptyOf(text: string | null): string | null {
  return absent(text) ? null : text;
}

function stringsOf(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}
