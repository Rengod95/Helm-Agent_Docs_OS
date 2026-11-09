// 명령줄 인자 해석(손으로 쓴 엄격한 파서). 모르는 옵션, 중복, 값 없음, 상대 경로, 짝이 맞지 않는 옵션은 사용법 오류다(종료코드 2).
// `--name value`와 `--name=value`를 모두 받는다. 위치 인자는 받지 않는다. 시각과 파일 존재는 여기서 보지 않는다(`preflight.ts`).
import path from "node:path";
import { err, ok, type Result } from "@fresnel/contracts";

const DEFAULT_LISTEN = "127.0.0.1:8480";
/** 루프백 리스너가 실제로 묶는 주소. 게이트웨이는 `127.0.0.1`에만 묶으므로 다른 루프백 이름은 받지 않는다 */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["127.0.0.1", "localhost"]);
const WILDCARD_HOSTS: ReadonlySet<string> = new Set(["0.0.0.0", "::"]);
const VALUE_FLAGS: ReadonlySet<string> = new Set([
  "--socket",
  "--state-dir",
  "--listen",
  "--listen-tls",
  "--hosts",
  "--tls-cert",
  "--tls-key",
  "--ui",
]);

export const USAGE_TEXT: string = `usage: bun run src/web/main.ts --socket <abs path> --state-dir <abs dir> [options]

  --socket <path>           service Unix socket (absolute, required)
  --state-dir <dir>         origin state folder (absolute, required). Files go under <dir>/remote
  --listen <host:port>      loopback HTTP listener (default ${DEFAULT_LISTEN}; host 127.0.0.1 or localhost; port 0 picks a free port)
  --listen-tls <host:port>  external HTTPS listener (TLS 1.3 only). Off unless given
  --hosts <a,b,...>         extra Host names for the TLS listener (needs --listen-tls)
  --tls-cert <path>         user certificate PEM (needs --tls-key and --listen-tls)
  --tls-key <path>          user private key PEM (needs --tls-cert and --listen-tls)
  --ui <dir>                UI bundle folder that contains index.html (absolute)
  --help                    print this help and exit

Control: one JSON line per command on stdin. See the header of src/web/main.ts.
`;

export interface ArgDefaults {
  /** `--ui`를 주지 않았을 때의 UI 폴더(절대 경로) */
  readonly uiDir: string;
}

export interface TlsArgs {
  /** 바인드 주소(괄호를 뺀 값). 모든 주소면 `0.0.0.0` 또는 `::` */
  readonly host: string;
  readonly port: number;
  /** 받을 `Host` 이름: 리스너 주소(모든 주소가 아니면)와 `--hosts`를 합친 목록 */
  readonly hosts: readonly string[];
  readonly certPath: string | null;
  readonly keyPath: string | null;
}

export interface WebOptions {
  readonly socketPath: string;
  readonly stateDir: string;
  readonly loopbackPort: number;
  readonly tls: TlsArgs | null;
  readonly uiDir: string;
}

export type ParsedArgs =
  | { readonly kind: "help" }
  | { readonly kind: "run"; readonly options: WebOptions };

export interface UsageError {
  readonly message: string;
}

function usage(message: string): Result<never, UsageError> {
  return err({ message });
}

/** `host:port`를 나눈다. IPv6는 `[addr]:port`다. 모양이 틀리면 null */
export function parseHostPort(
  text: string,
): { readonly host: string; readonly port: number } | null {
  const match = /^(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+):(\d{1,5})$/u.exec(text);
  if (match === null) return null;
  const [, rawHost = "", digits = ""] = match;
  const port = Number(digits);
  if (!Number.isInteger(port) || port > 65_535) return null;
  const host = rawHost.startsWith("[") ? rawHost.slice(1, -1) : rawHost;
  return { host, port };
}

const HOST_NAME: RegExp = /^(?:\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)$/u;

function parseHostList(text: string): Result<readonly string[], UsageError> {
  const names: string[] = [];
  for (const raw of text.split(",")) {
    if (raw.length === 0 || raw.length > 253 || !HOST_NAME.test(raw)) {
      return usage(`--hosts has a bad name: "${raw}"`);
    }
    const bare = raw.startsWith("[") ? raw.slice(1, -1) : raw;
    if (!names.includes(bare)) names.push(bare);
  }
  return ok(names);
}

function absoluteOf(flag: string, value: string): Result<string, UsageError> {
  if (!path.isAbsolute(value)) return usage(`${flag} must be an absolute path`);
  return ok(path.resolve(value));
}

/** 인자 배열을 해석한다. `--help`는 다른 옵션이 모두 맞을 때만 이긴다 */
export function parseArgs(
  argv: readonly string[],
  defaults: ArgDefaults,
): Result<ParsedArgs, UsageError> {
  const values = new Map<string, string>();
  let help = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    const eq = arg.indexOf("=");
    const flag = arg.startsWith("--") && eq > 0 ? arg.slice(0, eq) : arg;
    if (flag === "--help") {
      if (eq >= 0) return usage("--help takes no value");
      help = true;
      continue;
    }
    if (!VALUE_FLAGS.has(flag)) return usage(`unknown option: ${flag}`);
    if (values.has(flag)) return usage(`${flag} is given more than once`);
    let value: string;
    if (eq >= 0) {
      value = arg.slice(eq + 1);
    } else {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) return usage(`${flag} needs a value`);
      value = next;
      index += 1;
    }
    if (value.length === 0) return usage(`${flag} needs a value`);
    values.set(flag, value);
  }
  if (help) return ok({ kind: "help" });

  const socket = values.get("--socket");
  if (socket === undefined) return usage("--socket is required");
  const stateDir = values.get("--state-dir");
  if (stateDir === undefined) return usage("--state-dir is required");
  const socketPath = absoluteOf("--socket", socket);
  if (!socketPath.ok) return socketPath;
  const stateAbs = absoluteOf("--state-dir", stateDir);
  if (!stateAbs.ok) return stateAbs;

  const listen = parseHostPort(values.get("--listen") ?? DEFAULT_LISTEN);
  if (listen === null) return usage("--listen needs <host>:<port>");
  if (!LOOPBACK_HOSTS.has(listen.host)) {
    return usage(
      `--listen must be a loopback address (127.0.0.1 or localhost), not ${listen.host}`,
    );
  }

  const uiArg = values.get("--ui");
  const uiDir: Result<string, UsageError> =
    uiArg === undefined ? ok(path.resolve(defaults.uiDir)) : absoluteOf("--ui", uiArg);
  if (!uiDir.ok) return uiDir;

  const tls = parseTls(values);
  if (!tls.ok) return tls;

  return ok({
    kind: "run",
    options: {
      socketPath: socketPath.value,
      stateDir: stateAbs.value,
      loopbackPort: listen.port,
      tls: tls.value,
      uiDir: uiDir.value,
    },
  });
}

function parseTls(values: ReadonlyMap<string, string>): Result<TlsArgs | null, UsageError> {
  const listenTls = values.get("--listen-tls");
  const hostsText = values.get("--hosts");
  const certText = values.get("--tls-cert");
  const keyText = values.get("--tls-key");
  if ((certText === undefined) !== (keyText === undefined)) {
    return usage("--tls-cert and --tls-key must be given together");
  }
  if (listenTls === undefined) {
    if (hostsText !== undefined) return usage("--hosts needs --listen-tls");
    if (certText !== undefined) return usage("--tls-cert and --tls-key need --listen-tls");
    return ok(null);
  }
  const listen = parseHostPort(listenTls);
  if (listen === null) return usage("--listen-tls needs <host>:<port>");
  const extra: Result<readonly string[], UsageError> =
    hostsText === undefined ? ok([]) : parseHostList(hostsText);
  if (!extra.ok) return extra;
  const wildcard = WILDCARD_HOSTS.has(listen.host);
  if (wildcard && extra.value.length === 0) {
    return usage("--listen-tls on a wildcard address needs --hosts (the names the browser uses)");
  }
  let certPath: string | null = null;
  if (certText !== undefined) {
    const made = absoluteOf("--tls-cert", certText);
    if (!made.ok) return made;
    certPath = made.value;
  }
  let keyPath: string | null = null;
  if (keyText !== undefined) {
    const made = absoluteOf("--tls-key", keyText);
    if (!made.ok) return made;
    keyPath = made.value;
  }
  const hosts = [...(wildcard ? [] : [listen.host]), ...extra.value].filter(
    (name, index, all) => all.indexOf(name) === index,
  );
  return ok({ host: listen.host, port: listen.port, hosts, certPath, keyPath });
}
