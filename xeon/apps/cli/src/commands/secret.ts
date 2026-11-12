import { t } from "@fresnel/client/i18n";
import { assertNever, err, ok, parse, type Result } from "@fresnel/contracts";
import {
  SecretScopeSchema,
  type SecretName,
  type SecretScope,
} from "@fresnel/contracts/capabilities";
import type { SecretEntryAction, SecretValueSource } from "@fresnel/contracts/services";
import {
  WireError,
  type SecretListEntry,
  type SecretReferencesResult,
  type SecretTestResult,
} from "@fresnel/contracts/wire";
import type { CliIo } from "../io.ts";
import type { SecretCommand, SecretMetaFlags } from "../cli/command.ts";
import type { EngineHandle } from "../engine.ts";
import { renderFailure, type Failure } from "../errors.ts";
import { EXIT, type ExitCode } from "../exit-codes.ts";
import { openOneShotChannel, readUntilEnd, sendAndWipe } from "../secret-channel.ts";
import { withEngine, type CommandContext } from "./context.ts";

// L4.cli.spec §3.1 secret, §4.7. 값은 stdin이나 프롬프트로만 받는다. wire 요청·응답·이벤트·로그·오류에 값이 없다.
// 값을 넘기는 길은 둘이다. in-process 접속은 값 입력·열람 수단을 wire 밖(SecretOutOfBandPort)으로 맡긴다.
// 같은 컴퓨터의 서비스 접속은 로컬 일회용 채널(secret-channel.ts)을 열고 그 경로만 `channel`로 보낸다.
// 값을 담은 바이트 배열은 넘긴 직후 0으로 덮는다. 문자열로 바꾸지 않는다.

/** 비TTY stdin에서 받는 값의 상한. 시크릿 값은 짧다. 이보다 크면 잘못된 입력이다 */
const MAX_VALUE_BYTES = 64 * 1024;

type InputFailure = "cancelled" | "empty" | "mismatch" | "tooLarge";

function inputMessage(kind: InputFailure): Failure {
  switch (kind) {
    case "cancelled":
      return {
        message: t("cli.secret.input.cancelled.message"),
        fix: t("cli.secret.input.cancelled.fix"),
        code: EXIT.error,
        kind: "cancelled",
      };
    case "empty":
      return {
        message: t("cli.secret.input.empty.message"),
        fix: t("cli.secret.input.empty.fix"),
        code: EXIT.usage,
        kind: "value_empty",
      };
    case "mismatch":
      return {
        message: t("cli.secret.input.mismatch.message"),
        fix: t("cli.secret.input.mismatch.fix"),
        code: EXIT.error,
      };
    case "tooLarge":
      return {
        message: t("cli.secret.input.tooLarge.message"),
        fix: t("cli.secret.input.tooLarge.fix"),
        code: EXIT.usage,
      };
    default:
      return assertNever(kind, "InputFailure");
  }
}

function concat(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const joined = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    joined.set(chunk, at);
    at += chunk.byteLength;
    // 조각에도 값이 있었다: 합친 뒤 바로 덮는다
    chunk.fill(0);
  }
  return joined;
}

/** EOF까지 읽고 끝의 줄바꿈 하나를 지운다(§4.7) */
async function readAllStdin(
  stdin: ReadableStream<Uint8Array>,
): Promise<Result<Uint8Array, InputFailure>> {
  const reader = stdin.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      // oxlint-disable-next-line no-await-in-loop -- 스트림은 EOF까지 차례로 읽는다 (L4.cli.spec §4.7)
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      chunks.push(value);
      if (total > MAX_VALUE_BYTES) {
        for (const chunk of chunks) chunk.fill(0);
        return err("tooLarge");
      }
    }
  } finally {
    reader.releaseLock();
  }
  const joined = concat(chunks, total);
  let end = joined.byteLength;
  if (end > 0 && joined[end - 1] === 0x0a) {
    end -= 1;
    if (end > 0 && joined[end - 1] === 0x0d) end -= 1;
  }
  if (end === 0) {
    joined.fill(0);
    return err("empty");
  }
  const trimmed = joined.slice(0, end);
  joined.fill(0);
  return ok(trimmed);
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < left.byteLength; i += 1) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

/** TTY면 에코 없는 프롬프트로 두 번 받아 비교하고, 아니면 stdin 전체를 읽는다(§4.7) */
async function readValue(
  ctx: CommandContext,
  signal: AbortSignal,
): Promise<Result<Uint8Array, InputFailure>> {
  const { io } = ctx;
  if (!io.terminal.stdinIsTty) return readAllStdin(io.stdin);
  const first = await io.readSecret(t("cli.secret.prompt.value"), signal);
  if (first === null) return err("cancelled");
  if (first.byteLength === 0) return err("empty");
  const second = await io.readSecret(t("cli.secret.prompt.again"), signal);
  if (second === null) {
    first.fill(0);
    return err("cancelled");
  }
  const same = sameBytes(first, second);
  second.fill(0);
  if (!same) {
    first.fill(0);
    return err("mismatch");
  }
  return ok(first);
}

interface EntryOutcome {
  readonly started: boolean;
  readonly inputFailure: InputFailure | null;
  /** 호스트가 로컬 채널을 거절했다(`secret.localOnly`) */
  readonly refused: boolean;
}

/** 같은 컴퓨터의 서비스 접속인가. 맡길 수단이 없고 라우트가 이 기기의 서비스일 때만 로컬 채널을 쓴다 */
function usesChannel(handle: EngineHandle): boolean {
  return handle.secretOutOfBand === null && handle.localService;
}

function isLocalOnly(caught: unknown): boolean {
  return caught instanceof WireError && caught.data.kind === "secret.localOnly";
}

/** 값을 한 번 받는다. 받은 값과 실패 종류를 `held`에 남긴다. 호출한 쪽이 값을 넘기거나 덮는다 */
async function takeValue(
  ctx: CommandContext,
  held: { value: Uint8Array | undefined; failure: InputFailure | null },
  signal: AbortSignal,
): Promise<Result<Uint8Array, InputFailure>> {
  const value = await readValue(ctx, signal);
  if (value.ok) {
    held.value = value.value;
    return value;
  }
  held.failure = value.error;
  return value;
}

/**
 * add·set·rotate의 값 입력과 secret.beginEntry. 값을 읽는 때는 호스트가 값을 청하는 순간이다: 맡긴 수단은 source.read()로,
 * 로컬 채널은 호스트가 연결하는 순간이다. 채널은 요청 동안만 열려 있고 끝나면(성공, 실패, 취소) 지운다
 */
async function enterValue(
  ctx: CommandContext,
  handle: EngineHandle,
  name: SecretName,
  action: SecretEntryAction,
): Promise<EntryOutcome> {
  const held: { value: Uint8Array | undefined; failure: InputFailure | null } = {
    value: undefined,
    failure: null,
  };
  const abort = new AbortController();
  const source: SecretValueSource = {
    async read() {
      const value = await takeValue(ctx, held, abort.signal);
      if (value.ok) return ok(value.value);
      return err({ kind: value.error === "empty" ? "input_empty" : "input_cancelled" });
    },
  };
  const retract = handle.secretOutOfBand?.offerEntry({ name, action, source });
  const channel = usesChannel(handle)
    ? await openOneShotChannel(async (socket, signal) => {
        const value = await takeValue(ctx, held, signal);
        // 취소나 빈 값은 아무것도 쓰지 않고 닫는다. 호스트는 빈 입력으로 받는다
        if (value.ok) await sendAndWipe(socket, value.value);
        else socket.end();
      })
    : undefined;
  try {
    let started = false;
    let refused = false;
    try {
      const result = await handle.connection.request("secret.beginEntry", {
        name,
        action,
        ...(channel === undefined ? {} : { channel: channel.path }),
      });
      started = result.started;
    } catch (caught) {
      if (!isLocalOnly(caught)) throw caught;
      refused = true;
    }
    return { started, inputFailure: held.failure, refused };
  } finally {
    retract?.();
    abort.abort();
    // 연결이 들어와 처리 중이면 그것이 끝난 뒤 지운다
    await channel?.close();
    // 호스트가 넘긴 뒤에도 CLI 쪽 사본을 덮는다(§4.7)
    held.value?.fill(0);
  }
}

/** 같은 컴퓨터에서만 값을 넣을 수 있다. 원격 접속이거나 호스트가 채널을 거절했을 때다 */
function enterLocalOnly(action: SecretEntryAction): Failure {
  return {
    message: t("cli.secret.localOnly.enter.message"),
    fix: t("cli.secret.localOnly.enter.fix", { action }),
    code: EXIT.error,
    kind: "service_local_only",
  };
}

/** 같은 컴퓨터에서만 값을 볼 수 있다. 원격 접속이거나 호스트가 채널을 거절했을 때다 */
function revealLocalOnly(): Failure {
  return {
    message: t("cli.secret.localOnly.reveal.message"),
    fix: t("cli.secret.localOnly.reveal.fix"),
    code: EXIT.error,
    kind: "service_local_only",
  };
}

function startFailure(
  handle: EngineHandle,
  outcome: EntryOutcome,
  action: SecretEntryAction,
): Failure {
  if (outcome.inputFailure !== null) return inputMessage(outcome.inputFailure);
  if (outcome.refused || (handle.secretOutOfBand === null && !handle.localService)) {
    return enterLocalOnly(action);
  }
  return {
    message: t("cli.secret.start.notSaved.message"),
    fix: t("cli.secret.start.notSaved.fix"),
    code: EXIT.error,
    kind: "unknown",
  };
}

function hasMetaFlags(flags: SecretMetaFlags): boolean {
  return (
    flags.desc !== undefined ||
    flags.scope !== undefined ||
    flags.hosts !== undefined ||
    flags.expires !== undefined
  );
}

function usageFailure(message: string, fix: string): Failure {
  return { message, fix, code: EXIT.usage };
}

/** 메타 플래그를 secret.meta로 적용한다. --hosts는 기존 사용 정책을 읽어 hosts만 바꾼다 */
async function applyMeta(
  handle: EngineHandle,
  name: SecretName,
  flags: SecretMetaFlags,
): Promise<Result<SecretListEntry, Failure>> {
  const { connection } = handle;
  let scope: SecretScope | undefined;
  if (flags.scope !== undefined) {
    const parsed = parse(SecretScopeSchema, flags.scope);
    if (!parsed.ok) {
      return err(
        usageFailure(
          t("cli.secret.scope.invalid.message", { scope: flags.scope }),
          t("cli.secret.scope.invalid.fix"),
        ),
      );
    }
    scope = parsed.value;
  }
  let use: NonNullable<SecretListEntry["meta"]>["use"] | undefined;
  if (flags.hosts !== undefined) {
    const listed = await connection.request("secret.list", { meta: true });
    const current = listed.secrets.find((entry) => entry.name === name)?.meta?.use;
    if (current === undefined) {
      return err({
        message: t("cli.secret.hosts.unreadable.message"),
        fix: t("cli.secret.hosts.unreadable.fix"),
        code: EXIT.error,
        kind: "unknown",
      });
    }
    use = { ...current, hosts: [...flags.hosts] };
  }
  const result = await connection.request("secret.meta", {
    name,
    ...(flags.desc === undefined ? {} : { desc: flags.desc }),
    ...(scope === undefined ? {} : { scope }),
    ...(flags.expires === undefined ? {} : { expiresAt: flags.expires }),
    ...(use === undefined ? {} : { use }),
  });
  return ok(result.secret);
}

// ── 명령 ─────────────────────────────────────────────────────────────────

function statusText(entry: SecretListEntry): string {
  return entry.status;
}

function metaLines(entry: SecretListEntry): readonly string[] {
  const lines: string[] = [];
  const { meta } = entry;
  if (meta !== undefined) {
    lines.push(t("cli.secret.meta.desc", { desc: meta.desc }));
    lines.push(t("cli.secret.meta.providerScope", { provider: meta.provider, scope: meta.scope }));
    lines.push(t("cli.secret.meta.expires", { expires: meta.expiresAt ?? t("cli.secret.none") }));
    lines.push(
      t("cli.secret.meta.approvalHosts", {
        approval: meta.approval,
        hosts: meta.use.hosts.join(", ") || t("cli.secret.none"),
      }),
    );
  }
  if (entry.lastUsedAt !== undefined)
    lines.push(t("cli.secret.meta.lastUsed", { at: entry.lastUsedAt }));
  return lines;
}

async function runLs(
  ctx: CommandContext,
  command: Extract<SecretCommand, { kind: "secret.ls" }>,
): Promise<ExitCode> {
  return withEngine(ctx, async (handle) => {
    const listed = await handle.connection.request("secret.list", {
      ...(command.meta ? { meta: true } : {}),
      ...(command.usage ? { usage: true } : {}),
    });
    // 시크릿 명령에는 메시지 탭을 붙이지 않는다. --json은 결과 객체만 쓴다(§4.7)
    if (command.output === "json") {
      await ctx.io.stdout(`${JSON.stringify(listed.secrets, null, 2)}\n`);
      return EXIT.ok;
    }
    if (listed.secrets.length === 0) {
      await ctx.io.stderr(t("cli.secret.ls.empty"));
      return EXIT.ok;
    }
    const lines: string[] = [];
    for (const entry of listed.secrets) {
      lines.push(`${entry.name}  ${statusText(entry)}`);
      lines.push(...metaLines(entry));
    }
    await ctx.io.stdout(`${lines.join("\n")}\n`);
    return EXIT.ok;
  });
}

async function runEntry(
  ctx: CommandContext,
  name: SecretName,
  action: SecretEntryAction,
  flags: SecretMetaFlags,
): Promise<ExitCode> {
  if (action === "rotate" && !ctx.io.terminal.stdinIsTty) {
    await ctx.io.stderr(
      renderFailure(
        usageFailure(
          t("cli.secret.rotate.terminalOnly.message"),
          t("cli.secret.rotate.terminalOnly.fix"),
        ),
      ),
    );
    return EXIT.usage;
  }
  return withEngine(ctx, async (handle) => {
    const outcome = await enterValue(ctx, handle, name, action);
    if (!outcome.started) {
      const failure = startFailure(handle, outcome, action);
      await ctx.io.stderr(renderFailure(failure));
      return failure.code;
    }
    if (action === "add" && hasMetaFlags(flags)) {
      const applied = await applyMeta(handle, name, flags);
      if (!applied.ok) {
        await ctx.io.stderr(
          renderFailure({
            ...applied.error,
            message: t("cli.secret.metaNotApplied.message", { reason: applied.error.message }),
          }),
        );
        return applied.error.code;
      }
    }
    const done =
      action === "add"
        ? t("cli.secret.done.added", { name })
        : action === "set"
          ? t("cli.secret.done.set", { name })
          : t("cli.secret.done.rotated", { name });
    await ctx.io.stdout(done);
    return EXIT.ok;
  });
}

async function runMeta(
  ctx: CommandContext,
  command: Extract<SecretCommand, { kind: "secret.meta" }>,
): Promise<ExitCode> {
  if (!hasMetaFlags(command.meta)) {
    await ctx.io.stderr(
      renderFailure(
        usageFailure(
          t("cli.secret.meta.nothingToChange.message"),
          t("cli.secret.meta.nothingToChange.fix"),
        ),
      ),
    );
    return EXIT.usage;
  }
  return withEngine(ctx, async (handle) => {
    const applied = await applyMeta(handle, command.name, command.meta);
    if (!applied.ok) {
      await ctx.io.stderr(renderFailure(applied.error));
      return applied.error.code;
    }
    await ctx.io.stdout(
      `${[`${applied.value.name}  ${statusText(applied.value)}`, ...metaLines(applied.value)].join("\n")}\n`,
    );
    return EXIT.ok;
  });
}

async function confirmedByUser(ctx: CommandContext, question: string): Promise<boolean> {
  const answer = await ctx.io.readLine(`${question} [y/N] `, new AbortController().signal);
  const text = answer?.trim().toLowerCase() ?? "";
  return text === "y" || text === "yes";
}

/** 참조 목록에서 보일 세션 수. 나머지는 개수로 줄인다 */
const REFERENCE_SESSIONS_SHOWN = 5;

/** 삭제 전에 보일 참조 요약 한 줄(L4.cli.spec §4.7 rm). 값은 없고 설정 키, 활성 lease 수, 최근 사용한 세션만 있다 */
function referencesLine(name: string, found: SecretReferencesResult): string {
  const keys = found.settingKeys.length === 0 ? t("cli.secret.none") : found.settingKeys.join(", ");
  const shown = found.sessions.slice(0, REFERENCE_SESSIONS_SHOWN);
  const more = found.sessions.length - shown.length;
  const sessions =
    shown.length === 0
      ? t("cli.secret.none")
      : more > 0
        ? t("cli.secret.references.threadsMore", { shown: shown.join(", "), more: String(more) })
        : shown.join(", ");
  return t("cli.secret.references.line", {
    name,
    keys,
    leases: String(found.activeLeases),
    sessions,
  });
}

function hasReferences(found: SecretReferencesResult): boolean {
  return found.settingKeys.length > 0 || found.activeLeases > 0 || found.sessions.length > 0;
}

async function runRm(
  ctx: CommandContext,
  command: Extract<SecretCommand, { kind: "secret.rm" }>,
): Promise<ExitCode> {
  if (!command.yes && !ctx.io.terminal.stdinIsTty) {
    await ctx.io.stderr(
      renderFailure(
        usageFailure(t("cli.secret.rm.noTerminal.message"), t("cli.secret.rm.noTerminal.fix")),
      ),
    );
    return EXIT.usage;
  }
  return withEngine(ctx, async (handle) => {
    // 이 시크릿을 가리키는 곳을 먼저 읽는다(secret.references). 이 메서드를 모르는 호스트는 사용 정책만 보인다
    const references = handle.supports("secret.references")
      ? await handle.connection.request("secret.references", { name: command.name })
      : null;
    if (!command.yes) {
      // 참조하는 정책을 보인 뒤 확인한다(§3.1). 사용 중이면 호스트가 거부한다
      const listed = await handle.connection.request("secret.list", { meta: true });
      const entry = listed.secrets.find((candidate) => candidate.name === command.name);
      if (entry?.meta !== undefined) {
        const { use } = entry.meta;
        await ctx.io.stdout(
          t("cli.secret.rm.policy", {
            name: command.name,
            tools: use.tools.join(", ") || t("cli.secret.none"),
            hosts: use.hosts.join(", ") || t("cli.secret.none"),
          }),
        );
      }
      if (references !== null) {
        await ctx.io.stdout(referencesLine(command.name, references));
        if (references.activeLeases > 0) {
          // 열려 있는 lease가 있으면 호스트가 어차피 거부한다. 묻지 않고 이유를 알린다
          await ctx.io.stderr(
            renderFailure({
              message: t("cli.errors.secret.inUse.message", {
                leases: String(references.activeLeases),
              }),
              fix: t("cli.errors.secret.inUse.fix"),
              kind: "unknown",
            }),
          );
          return EXIT.error;
        }
      }
      if (!(await confirmedByUser(ctx, t("cli.secret.rm.confirm", { name: command.name })))) {
        await ctx.io.stderr(t("cli.secret.rm.kept"));
        return EXIT.error;
      }
    } else if (references !== null && hasReferences(references)) {
      // --yes는 묻지 않고 지운다. 참조가 남는다는 사실은 stderr에 남긴다
      await ctx.io.stderr(referencesLine(command.name, references));
    }
    const removed = await handle.connection.request("secret.remove", { name: command.name });
    if (!removed.removed) {
      await ctx.io.stderr(
        renderFailure({
          message: t("cli.errors.secret.missing.message"),
          fix: t("cli.secret.rm.missing.fix"),
          kind: "not_found",
        }),
      );
      return EXIT.error;
    }
    await ctx.io.stdout(t("cli.secret.rm.removed", { name: command.name }));
    return EXIT.ok;
  });
}

/** secret test의 한 줄. 길이와 SHA-256 앞 8자만 있고 값은 없다(L0.secrets.spec SecretTestResult) */
function testLine(name: string, tested: SecretTestResult): string {
  if (tested.state === "missing") return `${name}: missing\n`;
  if (!tested.decryptable) return t("cli.secret.test.undecryptable", { name });
  const length =
    tested.length === null ? "" : t("cli.secret.test.length", { length: String(tested.length) });
  const prefix =
    tested.sha256Prefix === null
      ? ""
      : t("cli.secret.test.sha256", { prefix: tested.sha256Prefix });
  return t("cli.secret.test.decryptable", { name, length, prefix });
}

async function runTest(
  ctx: CommandContext,
  command: Extract<SecretCommand, { kind: "secret.test" }>,
): Promise<ExitCode> {
  return withEngine(ctx, async (handle) => {
    const tested = await handle.connection.request("secret.test", { name: command.name });
    if (command.output === "json") {
      await ctx.io.stdout(`${JSON.stringify({ name: command.name, ...tested })}\n`);
    } else {
      await ctx.io.stdout(testLine(command.name, tested));
    }
    return tested.state === "registered" && tested.decryptable ? EXIT.ok : EXIT.error;
  });
}

/** 값을 바이트 그대로 터미널에 쓰고 줄바꿈을 붙인다. 문자열을 만들지 않는다 */
async function writeRevealed(io: CliIo, bytes: Uint8Array): Promise<void> {
  const writer = io.stdoutStream.getWriter();
  try {
    await writer.write(bytes);
    await writer.write(new TextEncoder().encode("\n"));
  } finally {
    writer.releaseLock();
  }
}

async function runReveal(
  ctx: CommandContext,
  command: Extract<SecretCommand, { kind: "secret.reveal" }>,
): Promise<ExitCode> {
  const { io } = ctx;
  // 사람 전용이다: stdin과 stdout이 모두 TTY일 때만 한다(파서가 먼저 거르지만 여기서도 거른다)
  if (!io.terminal.stdinIsTty || !io.terminal.stdoutIsTty) {
    await io.stderr(
      renderFailure(
        usageFailure(t("cli.usage.secret.reveal.message"), t("cli.usage.secret.reveal.fix")),
      ),
    );
    return EXIT.usage;
  }
  return withEngine(ctx, async (handle) => {
    // OS 인증 재확인(os-auth)을 쓸 수 없는 터미널이다: 이름을 다시 입력하는 TTY 확인(tty-confirm)만 받는다(§4.7)
    await io.stdout(t("cli.secret.reveal.warning", { name: command.name }));
    const typed = await io.readLine(t("cli.secret.reveal.prompt"), new AbortController().signal);
    if (typed?.trim() !== command.name) {
      await io.stderr(
        renderFailure({
          message: t("cli.secret.reveal.notConfirmed.message"),
          fix: t("cli.secret.reveal.notConfirmed.fix"),
        }),
      );
      return EXIT.error;
    }
    const verifiedAt = handle.clock.now();
    const retract = handle.secretOutOfBand?.offerReveal({
      name: command.name,
      reauth: { method: "tty-confirm", verifiedAt },
      show: (view) => writeRevealed(io, view.bytes),
    });
    // 같은 컴퓨터의 서비스 접속은 호스트가 값을 채널에 쓰면 받아 터미널에 쓴다(§4.7)
    const channel = usesChannel(handle)
      ? await openOneShotChannel(async (socket) => {
          const bytes = await readUntilEnd(socket, MAX_VALUE_BYTES);
          if (bytes === undefined) return;
          try {
            await writeRevealed(io, bytes);
          } finally {
            bytes.fill(0);
          }
        })
      : undefined;
    try {
      let started = false;
      let refused = false;
      try {
        const result = await handle.connection.request("secret.beginReveal", {
          name: command.name,
          ...(channel === undefined ? {} : { channel: channel.path, reauth: "tty-confirm" }),
        });
        started = result.started;
      } catch (caught) {
        if (!isLocalOnly(caught)) throw caught;
        refused = true;
      }
      if (started) return EXIT.ok;
      const failure: Failure =
        refused || (handle.secretOutOfBand === null && !handle.localService)
          ? revealLocalOnly()
          : {
              message: t("cli.secret.reveal.notShown.message"),
              fix: t("cli.secret.reveal.notShown.fix"),
              code: EXIT.error,
              kind: "unknown",
            };
      await io.stderr(renderFailure(failure));
      return failure.code;
    } finally {
      retract?.();
      await channel?.close();
    }
  });
}

export async function runSecret(ctx: CommandContext, command: SecretCommand): Promise<ExitCode> {
  // 시크릿 명령의 실패는 종류 코드 줄을 싣는다(L4.cli.spec §4.7). 아래 실행 함수는 모두 이 문맥을 쓴다
  const secret: CommandContext = { ...ctx, failureScope: "secret" };
  switch (command.kind) {
    case "secret.ls":
      return runLs(secret, command);
    case "secret.add":
      return runEntry(secret, command.name, "add", command.meta);
    case "secret.set":
      return runEntry(secret, command.name, "set", {});
    case "secret.rotate":
      return runEntry(secret, command.name, "rotate", {});
    case "secret.meta":
      return runMeta(secret, command);
    case "secret.rm":
      return runRm(secret, command);
    case "secret.test":
      return runTest(secret, command);
    case "secret.reveal":
      return runReveal(secret, command);
    default:
      return assertNever(command, "SecretCommand");
  }
}
