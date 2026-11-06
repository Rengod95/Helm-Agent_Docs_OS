import { afterEach, beforeEach, expect, test } from "bun:test";
import { activeLocale, setActiveLocale, type Locale } from "@fresnel/client/i18n";
import { WIRE_PROTOCOL_VERSION } from "@fresnel/contracts/wire";
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

test("a missing conversation id names the command and the form to use", () => {
  expect(usageOf(["sessions", "show"])).toEqual({
    code: "missingArgument",
    message: "sessions show needs a conversation id",
    fix: "fresnel sessions show <id>",
  });
});

test("an unknown command points to the command list", () => {
  expect(usageOf(["frobnicate"])).toEqual({
    code: "unknownCommand",
    message: "Unknown command: frobnicate",
    fix: "Check the command list with fresnel --help",
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
    fix: "fresnel config set <key> <value> [--scope user|project|local]",
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
    fix: "fresnel schedule add <prompt> (--every <seconds> | --at <time> | --remote | --watch <path>[,<path>…] | --loop <seconds> --max-iterations <n> --expires-in <seconds>) [--title <title>] [--workspace <folder>] [--disabled]",
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
    fix: "fresnel secret rm <name>",
  });
});

test("--provider accepts only sops and the fix names it", () => {
  for (const provider of ["op", "bws", "keychain"]) {
    expect(usageOf(["secret", "add", "api-key", "--provider", provider])).toEqual({
      code: "unexpectedArgument",
      message: "The --provider value is not valid",
      fix: "Use one of sops",
    });
  }
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
    `fresnel: interactive agent runtime

Usage: fresnel [common flags] [command] [arguments]

Commands
  chat                      Interactive mode (default). Switches to print mode when the terminal is not interactive
  chat -p <input>           Print mode: run one turn with this input and write the reply to stdout
                            -p - or a bare -p reads all of stdin as the input
  chat -p <input> --quiet   Do not write the one-line usage summary to stderr at the end
  chat -p <input> --json    JSON mode: write the JSON-RPC messages exchanged with the engine, one per line
  chat -p <input> --auto-approve
                            Print mode: approve a tool call once. Questions, plans, and reviews are declined
  chat --continue           Resume the last conversation in the current working folder
  chat --resume <id>        Resume the given conversation
  chat --set <key>=<value>  Override a setting for this conversation only (can be repeated)
  sessions ls [--all] [--limit n] [--json]
  sessions show <id> [--json]
  sessions fork <id> [--at <item id>]
  sessions rm <id> [--yes]  List, show, fork, and delete conversations
  sessions rename <id> <title>  Change the conversation title (200 characters or fewer)
  config get [<key>…]       Show the effective values and where they come from
  config schema --scope <managed|user|project|local> [--out <path>] [--core-only]
                            Write the JSON Schema for the settings files
  config set <key> <value> [--scope user|project|local]
  config reset <key> [--scope user|project|local]
  config list [--prefix <p>] [--deprecated] [--json]
                            Set, clear, and list settings
  secret ls|add|set|meta|rotate|rm|test|reveal
                            Manage secrets. Values are read only from a prompt or stdin. Use reveal only in a terminal
  trust [status] [--json]   Show the work folder trust state for this working folder, and the choices
  trust allow|deny [--scope folder|parent|session]
                            Send a trust decision. When trusted, .mcp.json, project skills, and project commands are read
  db export <folder> [--json] [--yes] Export the storage files read-only, without the engine. The engine may be running
  db restore <folder> [--json] Restore a database from an export. Close the engine first. Secrets need the age key separately
  schedule add <prompt…> (--every <seconds> | --at <time> | --remote | --watch <path>[,…] | --loop <seconds> …)
                            Create a schedule. If service mode is off, it is only saved and does not run. See fresnel help schedule
  schedule list [--all] [--json]
  schedule cancel <id>      Turn a schedule off
  schedule run <id>         Run a remote schedule once, now
  service start|status|stop|ensure [--json] [--safe-mode] [--listen-tcp <host>:<port> [--allow-non-loopback]]
                            Shared service mode. start and ensure start the service, or attach to it if it is running.
                            status and stop check it and stop it. Safe mode and TCP apply only when a new service starts
                            Schedules run only in service mode. See fresnel help schedule
  group new <name> [--drive|--policy] [--dir <folder>] [--json]
                            Create a group skeleton. The default is an observe group, --drive makes a drive group,
                            and --policy makes a policy group. The target folder must be empty, and dependencies are not installed
  author scaffold|validate|pack|install|remove|ls
                            Create, check, pack, install and remove extensions without a model. ls lists installed extensions. install and remove ask for confirmation; without a terminal they need --yes
  doctor [--json]           Diagnose the engine, storage, secret store, terminal, and search providers
  usage [--thread <id>] [--json]
                            Model usage (tokens, cost, calls). Without a conversation it is the total of all conversations
  version [--json]          Show the version

Common flags
  -h, --help                Show help
  --no-color                Turn off color (the NO_COLOR environment variable does the same)
  -C <folder>               Working folder
  --remote <address>        Remote service address. Takes precedence over the l0.process.service.remote setting
                          unix:/abs, tcp://host:port, ssh://[user@]host[:port]/abs/socket

Exit codes
  0 ok   1 error   2 usage error   3 environment problem   4 conversation locked
  129 SIGHUP   130 interrupted (Ctrl+C)   143 SIGTERM
`,
  );
});

test("the schedule help topic is English and says schedules run only in service mode", async () => {
  expect(await textOf((write) => runHelp("schedule", write))).toBe(
    `Usage: fresnel schedule add <prompt…> (--every <seconds> | --at <time> | --remote | --watch <path>[,<path>…] | --loop <seconds> --max-iterations <n> --expires-in <seconds>)
                       [--title <title>] [--workspace <folder>] [--disabled]
       fresnel schedule list [--all] [--json]
       fresnel schedule cancel <id>
       fresnel schedule run <id>

  --every <seconds>      Run the prompt in a new conversation every this many seconds. The minimum is 300 seconds
  --at <time>            Run once at an RFC 3339 time
  --remote               Does not run on a schedule. Run it now with fresnel schedule run <id>
  --watch <path>[,…]     Run when a path changes. Waits for --debounce <ms> (default 1000) before running
  --loop <seconds>       Repeat the same prompt. Give --max-iterations and --expires-in with it
  --title <title>        Title shown in the list (200 characters or fewer)
  --workspace <folder>   Working folder of the run conversation. If it is omitted, the default folder of the host is used
  --disabled             Create it, but leave it turned off
  --remote is a trigger flag. Give the remote service address before the command (fresnel --remote <address> schedule list)
  Schedules run only in service mode. If it is off, they are only saved, and one warning line is shown
`,
  );
});

test("a help topic is English", async () => {
  expect(await textOf((write) => runHelp("db", write))).toBe(
    `Usage: fresnel db export <folder> [--json] [--yes]
       fresnel db restore <folder> [--json]

  <folder>      Folder to export to. It is created if it is missing. If it exists, it must be empty. A relative path is based on the working folder (-C)
  --json        Write the export result (destDir, exportedAt, blobCount, missingBlobs) as JSON
  --yes         Skip the confirmation. The copy may contain secret values in plain text. Without a terminal this flag is required

  Creates <folder>/fresnel.sqlite, <folder>/blobs/, and <folder>/manifest.json. The engine is not started.

  restore puts an export back in place of the current database. It verifies the backup first, refuses while an engine is running, refuses a backup from a newer version, and keeps the current database in <data directory>/restore-previous/. Run it again if it was interrupted.
  Secrets are not in the backup: the age key (secrets/age/keys.txt) and the config file are not copied. Keep the age key separately.
`,
  );
});

test("the version lines are English", async () => {
  expect(await textOf((write) => runVersion("text", { cli: "0.0.0", bun: "1.4.3" }, write))).toBe(
    `fresnel 0.0.0\nContract ${WIRE_PROTOCOL_VERSION}\nBun 1.4.3\n`,
  );
});
