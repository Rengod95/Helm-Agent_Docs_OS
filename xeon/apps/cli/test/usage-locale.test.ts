import { afterEach, beforeEach, expect, test } from "bun:test";
import { activeLocale, setActiveLocale, type Locale } from "@xeon/client/i18n";
import { WIRE_PROTOCOL_VERSION } from "@xeon/contracts/wire";
import { parseArgv, type TerminalFacts, type UsageError } from "../src/cli/command.ts";
import { runHelp } from "../src/commands/help.ts";
import { runVersion } from "../src/commands/version.ts";

// 인자 오류, 도움말, 버전 문장을 영어 로케일에서 전체 문자열로 비교한다. 시험 프로세스의 로케일은 ko이므로 끝나면 되돌린다.

const TERMINAL: TerminalFacts = { stdinIsTty: true, stdoutIsTty: true };
let before: Locale = "ko";

beforeEach(() => {
  before = activeLocale();
  setActiveLocale("en");
});

afterEach(() => {
  setActiveLocale(before);
});

function usageOf(argv: readonly string[]): UsageError | undefined {
  const parsed = parseArgv(argv, TERMINAL, {});
  return parsed.ok ? undefined : parsed.error;
}

async function textOf(
  run: (write: (text: string) => Promise<void>) => Promise<unknown>,
): Promise<string> {
  let out = "";
  await run((text) => {
    out += text;
    return Promise.resolve();
  });
  return out;
}

test("a missing session id names the command and the form to use", () => {
  expect(usageOf(["sessions", "show"])).toEqual({
    code: "missingArgument",
    message: "sessions show needs a session id",
    fix: "xeon sessions show <id>",
  });
});

test("an unknown command points to the command list", () => {
  expect(usageOf(["frobnicate"])).toEqual({
    code: "unknownCommand",
    message: "Unknown command: frobnicate",
    fix: "Check the command list with xeon --help",
  });
});

test("continue and resume together is a usage error in English", () => {
  expect(usageOf(["chat", "--continue", "--resume", "thr_00000000000000000000000001"])).toEqual({
    code: "conflictingFlags",
    message: "--continue and --resume cannot be used together",
    fix: "Use only one of them",
  });
});

test("a config set without a value shows the full syntax", () => {
  expect(usageOf(["config", "set", "l4.cli.theme"])).toEqual({
    code: "missingArgument",
    message: "config set needs a key and a value",
    fix: "xeon config set <key> <value> [--scope user|project|local]",
  });
});

test("a --set without an equal sign shows the form to use", () => {
  expect(usageOf(["chat", "--set", "bad"])).toEqual({
    code: "invalidOverride",
    message: "The --set value has no =",
    fix: "Use the form --set <key>=<value>",
  });
});

test("a schedule without a trigger shows the schedule syntax", () => {
  expect(usageOf(["schedule", "add", "x"])).toEqual({
    code: "missingArgument",
    message:
      "No schedule trigger was given (choose one of --every, --at, --remote, --watch, or --loop)",
    fix: "xeon schedule add <prompt> (--every <seconds> | --at <time> | --remote | --watch <path>[,<path>…] | --loop <seconds> --max-iterations <n> --expires-in <seconds>) [--title <title>] [--workspace <folder>] [--disabled]",
  });
});

test("an invalid secret name explains the rule", () => {
  expect(usageOf(["secret", "add", "BAD"])).toEqual({
    code: "invalidSecretName",
    message: "The secret name has the wrong format",
    fix: "Use 2 to 64 characters: lowercase letters, digits, and hyphens, starting with a lowercase letter",
  });
});

test("a secret command without a name asks for one", () => {
  expect(usageOf(["secret", "rm"])).toEqual({
    code: "missingArgument",
    message: "secret rm needs a name",
    fix: "xeon secret rm <name>",
  });
});

test("a positional argument to version is refused in English", () => {
  expect(usageOf(["version", "extra"])).toEqual({
    code: "unexpectedArgument",
    message: "version takes no positional arguments",
    fix: "Only --json can be used",
  });
});

test("the help overview is English", async () => {
  expect(await textOf((write) => runHelp(null, write))).toBe(
    `xeon: interactive agent runtime

Usage: xeon [common flags] [command] [arguments]

Commands
  chat                      Interactive mode (default). Switches to print mode when the terminal is not interactive
  chat -p <input>           Print mode: run one turn with this input and write the reply to stdout
                            -p - or a bare -p reads all of stdin as the input
  chat -p <input> --json    JSON mode: write the JSON-RPC messages exchanged with the engine, one per line
  chat -p <input> --auto-approve
                            Print mode: approve a tool call once. Questions, plans, and reviews are declined
  chat --continue           Resume the last session in the current working folder
  chat --resume <id>        Resume the given session
  chat --set <key>=<value>  Override a setting for this session only (can be repeated)
  sessions ls [--all] [--limit n] [--json]
  sessions show <id> [--json]
  sessions fork <id> [--at <item id>]
  sessions rm <id> [--yes]  List, show, fork, and delete sessions
  sessions rename <id> <title>  Change the session title (200 characters or fewer)
  config get [<key>…]       Show the effective values and where they come from
  config schema --scope <managed|user|project|local> [--out <path>] [--core-only]
                            Write the JSON Schema for the settings files
  config set <key> <value> [--scope user|project|local]
  config reset <key> [--scope user|project|local]
  config list [--prefix <p>] [--deprecated] [--json]
                            Set, clear, and list settings
  secret ls|add|set|meta|rotate|rm|test|reveal
                            Manage secrets. Values are read only from a prompt or stdin. Use reveal only in a terminal
  trust [status] [--json]   Show the project trust state for this working folder, and the choices
  trust allow|deny [--scope folder|parent|session]
                            Send a trust decision. When trusted, .mcp.json, project skills, and project commands are read
  db export <folder> [--json] Export the storage files read-only, without the engine. The engine may be running
  schedule add <prompt…> (--every <seconds> | --at <time> | --remote | --watch <path>[,…] | --loop <seconds> …)
                            Create a schedule. If service mode is off, it is only saved and does not run. See xeon help schedule
  schedule list [--all] [--json]
  schedule cancel <id>      Turn a schedule off
  schedule run <id>         Run a remote schedule once, now
  service start|status|stop|ensure [--json] [--safe-mode] [--listen-tcp <host>:<port> [--allow-non-loopback]]
                            Shared service mode. start and ensure start the service, or attach to it if it is running.
                            status and stop check it and stop it. Safe mode and TCP apply only when a new service starts
  group new <name> [--drive|--policy] [--dir <folder>] [--json]
                            Create a group skeleton. The default is an observe group, --drive makes a drive group,
                            and --policy makes a policy group. The target folder must be empty, and dependencies are not installed
  doctor [--json]           Diagnose the engine, storage, secret store, terminal, and search providers
  version [--json]          Show the version

Common flags
  -h, --help                Show help
  --no-color                Turn off color (the NO_COLOR environment variable does the same)
  -C <folder>               Working folder
  --remote <address>        Remote service address. Takes precedence over the l0.process.service.remote setting
                          unix:/abs, tcp://host:port, ssh://[user@]host[:port]/abs/socket

Exit codes
  0 ok   1 error   2 usage error   3 environment problem   4 session locked
  129 SIGHUP   130 interrupted (Ctrl+C)   143 SIGTERM
`,
  );
});

test("a help topic is English", async () => {
  expect(await textOf((write) => runHelp("db", write))).toBe(
    `Usage: xeon db export <folder> [--json]

  <folder>      Folder to export to. It is created if it is missing. If it exists, it must be empty. A relative path is based on the working folder (-C)
  --json        Write the export result (destDir, exportedAt, blobCount, missingBlobs) as JSON

  Creates <folder>/xeon.sqlite, <folder>/blobs/, and <folder>/manifest.json. The engine is not started.
`,
  );
});

test("the version lines are English", async () => {
  expect(await textOf((write) => runVersion("text", { cli: "0.0.0", bun: "1.4.3" }, write))).toBe(
    `xeon 0.0.0\nContract ${WIRE_PROTOCOL_VERSION}\nBun 1.4.3\n`,
  );
});
