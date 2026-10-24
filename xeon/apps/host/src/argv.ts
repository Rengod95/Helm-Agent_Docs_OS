import type { HostCommand } from "./host-command.ts";
import type { SettingsFileScope } from "./settings.ts";

// L4.host-service.spec §3.2. 개발 진입 `bun xeon/apps/host/src/main.ts <서브커맨드>`의 인자 해석. 배포 바이너리의
// 명령줄 파싱과 도움말은 L4.cli.spec이 정한다. 여기서는 호스트가 소유한 서브커맨드(host --stdio, service *, config schema)만 본다.

const SCOPES: readonly SettingsFileScope[] = ["managed", "user", "project", "local"];

function isScope(value: string | undefined): value is SettingsFileScope {
  return SCOPES.some((scope) => scope === value);
}

export type ParsedArgv =
  | { readonly ok: true; readonly command: HostCommand }
  | { readonly ok: false; readonly message: string };

function parseConfigSchema(rest: readonly string[]): ParsedArgv {
  let scope: string | undefined;
  let out: string | undefined;
  let coreOnly = false;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--scope") {
      scope = rest[index + 1];
      index += 1;
    } else if (arg === "--out") {
      out = rest[index + 1];
      index += 1;
      if (out === undefined) return { ok: false, message: "--out needs a path" };
    } else if (arg === "--core-only") {
      coreOnly = true;
    } else {
      return { ok: false, message: `unknown argument: ${arg ?? ""}` };
    }
  }
  if (!isScope(scope)) {
    return { ok: false, message: "--scope must be one of managed, user, project, local" };
  }
  return {
    ok: true,
    command: { kind: "config-schema", scope, coreOnly, ...(out === undefined ? {} : { out }) },
  };
}

export function parseHostArgv(argv: readonly string[]): ParsedArgv {
  const [first, second, ...rest] = argv;
  if (first === "host" && second === "--stdio" && rest.length === 0) {
    return { ok: true, command: { kind: "host-stdio" } };
  }
  if (first === "config" && second === "schema") return parseConfigSchema(rest);
  if (first === "service") {
    if (second === "run") return { ok: true, command: { kind: "service-run" } };
    if (second === "start") return { ok: true, command: { kind: "service-start" } };
    if (second === "status") {
      return { ok: true, command: { kind: "service-status", json: rest.includes("--json") } };
    }
    if (second === "stop") return { ok: true, command: { kind: "service-stop" } };
    if (second === "ensure") return { ok: true, command: { kind: "service-ensure" } };
    if (second === "launch-mode") return { ok: true, command: { kind: "service-launch-mode" } };
    return { ok: false, message: `unknown service command: ${second ?? ""}` };
  }
  return {
    ok: false,
    message: "usage: main.ts host --stdio | config schema --scope <scope> | service <command>",
  };
}
