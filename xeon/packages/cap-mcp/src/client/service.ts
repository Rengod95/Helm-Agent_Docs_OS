import {
  assertNever,
  attempt,
  attemptAsync,
  eachAsync,
  parse,
  type Clock,
  type Logger,
  type Scheduler,
} from "@xeon/contracts";
import {
  CapabilityError,
  diffToolsets,
  toolsetFingerprint,
  MCP_SERVER_ID_PATTERN,
  McpServerDefSchema,
  type CallToolInputValue,
  type CallToolOutputValue,
  type GetPromptInputValue,
  type GetPromptOutputValue,
  type ListResourcesInputValue,
  type ListResourcesOutputValue,
  type McpContent,
  type McpInputRequired,
  type McpServerDef,
  type McpServerStatus,
  type McpToolInfo,
  type PromptInfo,
  type ResourceInfo,
  type ReadResourceInputValue,
  type ReadResourceOutputValue,
  type CallOptions,
  type CapabilityApi,
  type McpClient,
} from "@xeon/contracts/capabilities";
import type { JsonObject, JsonValue } from "@xeon/contracts/conversation";
import type { McpServersChangePayload } from "@xeon/contracts/extensions";
import type { McpService } from "@xeon/contracts/services";
import type { RawInputRequired, RawPrompt } from "../adapter.ts";
import { buildQuestions } from "../elicitation/questions.ts";
import { roundsExceeded } from "../elicitation/rounds.ts";
import { failureToError, mcpError } from "../errors.ts";
import { byteOrder } from "../order.ts";
import type { McpFileReader } from "../ports/files.ts";
import type { McpRulesSink } from "../ports/rules.ts";
import type { McpMasker } from "../ports/secrets.ts";
import type { McpStorePort } from "../ports/store.ts";
import type { McpContinuationSource, McpToolRegistrar } from "../ports/tools.ts";
import type { McpProjectTrust } from "../ports/trust.ts";
import { loadDefinitions, type LoadedDefinitions } from "../servers/definitions.ts";
import { buildApprovalRules, evaluateServer, filterTool } from "../servers/policy.ts";
import {
  DEFAULT_MCP_SETTINGS,
  readMcpSettings,
  type McpSettings,
  type McpSettingsSource,
} from "../settings.ts";
import type { TransportFactory } from "../transport/factory.ts";
import type { LoaderDiagnostic, ServerDefinition } from "../types.ts";
import { convertBlock, convertBlocks, limitContent, type BlobPutter } from "./content.ts";
import {
  createDynamicTool,
  orderedOf,
  resolveExposure,
  type McpDynamicTool,
  type McpExecuteContext,
} from "./dynamic-tools.ts";
import { createRegistry, type ServerRegistry, type ServerSnapshot } from "./registry.ts";
import { createStateStore, type StateStore } from "./state-store.ts";

// L2.mcp.spec §3.2 `mcp.client` 능력 구현과 `xeon.mcp`(McpService)의 조립. 서버 목록의 변화는 메모리에 모아
// 단계 경계(`applyBoundary`)에서 한 번에 도구 표에 반영한다(§4.9).

export interface McpDeps {
  readonly clock: Clock;
  readonly scheduler: Scheduler;
  readonly logger: Logger;
  readonly masker: McpMasker;
  /** 호출마다 읽는 설정 층. 변경이 다음 호출부터 적용된다 */
  readonly settings: McpSettingsSource;
  /** 프로젝트 루트. 없으면 프로젝트 출처 정의와 `.mcp.json`을 쓰지 않는다 */
  readonly projectRoot: string | undefined;
  readonly files: McpFileReader;
  readonly trust: McpProjectTrust;
  readonly transports: TransportFactory;
  /** 동적 도구를 올리는 쪽. 없으면 도구 집합 계산만 한다 */
  readonly tools: McpToolRegistrar | undefined;
  /** 연속 정보 전달 경로가 생기기 전의 우회(없어도 된다) */
  readonly continuations: McpContinuationSource | undefined;
  readonly rules: McpRulesSink | undefined;
  /** 상태 표. 없으면 저장하지 않는다 */
  readonly store: McpStorePort | undefined;
  /** 내장 도구 이름 등 서버 도구가 쓰면 안 되는 기계 이름 */
  readonly reservedToolNames: () => ReadonlySet<string>;
  /** `mcp_servers_change` 지점 발화(tap). 서버 상태나 도구 집합이 바뀐 단계 경계에서 한 번 부른다 */
  readonly onServersChange: ((payload: McpServersChangePayload) => void) | undefined;
  readonly client: { readonly name: string; readonly version: string };
  /** stdio 서버 종료 유예(SIGTERM 뒤 SIGKILL 전) */
  readonly stdioGraceMs: number;
}

export interface BoundaryReport {
  readonly changed: boolean;
  readonly toolsAdded: readonly string[];
  readonly toolsRemoved: readonly string[];
  readonly servers: McpServersChangePayload["servers"];
}

export interface McpRuntime {
  readonly service: McpService;
  /** 설정과 `.mcp.json`을 읽고 서버 연결을 시작한다(기다리지 않는다). 설정이 바뀌면 다시 부른다 */
  load(signal: AbortSignal): Promise<LoadedDefinitions>;
  /** 단계 경계: 모아 둔 변화를 도구 표에 한 번에 반영하고 `mcp_servers_change`를 발화한다 */
  applyBoundary(): Promise<BoundaryReport>;
  diagnostics(): readonly LoaderDiagnostic[];
  /** 진행 중인 연결 시도가 끝나기를 기다린다(시험과 종료) */
  settled(): Promise<void>;
  shutdown(): Promise<void>;
}

const NEVER_ABORTED = new AbortController().signal;

type ChangeStatus = McpServersChangePayload["servers"][number]["status"];

function changeStatusOf(snapshot: ServerSnapshot | undefined): ChangeStatus {
  if (snapshot === undefined) return "disabled";
  switch (snapshot.state) {
    case "connected":
      return "connected";
    case "connecting":
    case "reconnecting":
      return "disconnected";
    case "failed":
      return "error";
    case "disabled":
    case "blocked":
      return "disabled";
    default:
      return assertNever(snapshot.state, "changeStatusOf");
  }
}

/** 동기 본문을 서비스 메서드의 약속(CapabilityError 거부)에 맞게 Promise로 감싼다 */
function settle<T>(work: () => T): Promise<T> {
  const outcome = attempt(work);
  if (outcome.ok) return Promise.resolve(outcome.value);
  const cause = outcome.error.cause;
  return Promise.reject(
    cause instanceof Error ? cause : new Error("non-Error value was thrown", { cause }),
  );
}

function promptArgumentOf(
  argument: RawPrompt["arguments"][number],
): PromptInfo["arguments"][number] {
  return {
    name: argument.name,
    ...(argument.description === undefined ? {} : { description: argument.description }),
    ...(argument.required === undefined ? {} : { required: argument.required }),
  };
}

interface CallEnv {
  readonly signal: AbortSignal;
  readonly threadId: string | undefined;
}

function envOf(options: CallOptions | undefined): CallEnv {
  return {
    signal: options?.signal ?? NEVER_ABORTED,
    threadId: options?.context?.threadId,
  };
}

function callMsOf(definition: ServerDefinition, settings: McpSettings): number {
  return definition.def.timeouts?.callMs ?? settings.callTimeoutMs;
}

function inputRequiredOutput(
  method: string,
  server: string,
  round: number,
  raw: RawInputRequired,
  settings: McpSettings,
): McpInputRequired {
  if (roundsExceeded(round + 1, settings.maxInputRounds)) {
    throw mcpError(
      method,
      "input_rounds_exceeded",
      `the server asked for input more than ${settings.maxInputRounds} times`,
    );
  }
  const questions = buildQuestions(server, raw.inputRequests, settings.sampling === "ask");
  if (!questions.ok) throw mcpError(method, "input_unsupported", questions.error.message);
  return {
    status: "input_required",
    round,
    inputRequests: raw.inputRequests,
    requestState: raw.requestState,
    questions: questions.value,
  };
}

function checkRound(method: string, round: number, settings: McpSettings): void {
  if (roundsExceeded(round, settings.maxInputRounds)) {
    throw mcpError(
      method,
      "input_rounds_exceeded",
      `round ${round} is above the limit ${settings.maxInputRounds}`,
    );
  }
}

function promptsOf(server: string, snapshot: ServerSnapshot): PromptInfo[] {
  return snapshot.prompts.map((prompt): PromptInfo => ({
    server,
    name: prompt.name,
    ...(prompt.title === undefined ? {} : { title: prompt.title }),
    ...(prompt.description === undefined ? {} : { description: prompt.description }),
    arguments: prompt.arguments.map(promptArgumentOf),
  }));
}

export function createMcp(deps: McpDeps): McpRuntime {
  const dirty = new Set<string>();
  const ext = new Map<string, { readonly extension: string; readonly def: McpServerDef }>();
  const fingerprints = new Map<string, string>();
  const applied = new Map<string, { tool: McpDynamicTool; unregister: (() => void) | undefined }>();
  let loaded: LoadedDefinitions | undefined;
  let boundaryRunning: Promise<unknown> = Promise.resolve();

  const stateStore: StateStore | undefined =
    deps.store === undefined
      ? undefined
      : createStateStore({ store: deps.store, clock: deps.clock, masker: deps.masker });
  if (stateStore !== undefined) {
    const migrated = stateStore.migrate();
    if (!migrated.ok) deps.logger.error("mcp.state_migrate_failed", { kind: migrated.error.kind });
  }
  const blobs: BlobPutter | undefined =
    deps.store === undefined
      ? undefined
      : (bytes, mediaType) =>
          deps.store?.putBlob(bytes, mediaType) ?? {
            ok: false,
            error: { kind: "io", code: "no_store" },
          };

  const currentSettings = (threadId?: string): McpSettings =>
    readMcpSettings(deps.settings.layers(threadId));

  function persist(serverId: string): void {
    if (stateStore === undefined) return;
    const snapshot = registry.get(serverId);
    const outcome =
      snapshot === undefined
        ? stateStore.remove(serverId)
        : stateStore.save({
            serverId,
            source: snapshot.definition.source,
            state: snapshot.state,
            lastError: snapshot.lastError,
            lastConnectedAt: snapshot.lastConnectedAt,
            protocolVersion: snapshot.protocolVersion,
            toolsFingerprint: fingerprints.get(serverId),
          });
    if (!outcome.ok)
      deps.logger.warn("mcp.state_save_failed", { server: serverId, kind: outcome.error.kind });
  }

  const registry: ServerRegistry = createRegistry({
    clock: deps.clock,
    scheduler: deps.scheduler,
    logger: deps.logger,
    masker: deps.masker,
    transports: deps.transports,
    settings: () => loaded?.settings ?? currentSettings(),
    client: deps.client,
    onChanged: (serverId) => {
      dirty.add(serverId);
      persist(serverId);
    },
  });

  // ── 정의 합치기와 정책 ─────────────────────────────────────────────────

  function definitions(): readonly ServerDefinition[] {
    const out: ServerDefinition[] = [...(loaded?.servers ?? [])];
    for (const [id, entry] of ext) {
      if (out.some((existing) => existing.id === id)) continue;
      out.push({
        id,
        def: entry.def,
        source: `ext:${entry.extension}`,
        managed: false,
        requiresTrust: false,
      });
    }
    return out;
  }

  function resync(): void {
    const settings = loaded?.settings ?? DEFAULT_MCP_SETTINGS;
    const trusted = loaded?.trusted ?? false;
    registry.sync(
      definitions().map((definition) => {
        const verdict = evaluateServer(definition, settings, trusted);
        return { definition, blockedReason: verdict.blocked ? verdict.reason : undefined };
      }),
    );
  }

  // ── 노출 ─────────────────────────────────────────────────────────────────

  function exposure(): ReadonlyMap<string, readonly McpToolInfo[]> {
    const connected = registry.list().filter((snapshot) => snapshot.state === "connected");
    return resolveExposure(
      connected.map((snapshot) => ({ server: snapshot.definition, tools: snapshot.tools })),
      deps.reservedToolNames(),
    );
  }

  function statusOf(snapshot: ServerSnapshot): McpServerStatus {
    const exposed =
      snapshot.state === "connected"
        ? (exposure().get(snapshot.definition.id) ?? []).filter((info) => info.exposed).length
        : 0;
    return {
      server: snapshot.definition.id,
      ...(snapshot.definition.def.title === undefined
        ? {}
        : { title: snapshot.definition.def.title }),
      source: snapshot.definition.source,
      state: snapshot.state,
      transport: snapshot.definition.def.transport.type,
      ...(snapshot.protocolVersion === undefined
        ? {}
        : { protocolVersion: snapshot.protocolVersion }),
      toolCount: exposed,
      promptCount: snapshot.prompts.length,
      ...(snapshot.lastError === undefined ? {} : { lastError: { ...snapshot.lastError } }),
      ...(snapshot.blockedReason === undefined ? {} : { blockedReason: snapshot.blockedReason }),
    };
  }

  function snapshotOrThrow(method: string, server: string): ServerSnapshot {
    const snapshot = registry.get(server);
    if (snapshot === undefined)
      throw mcpError(method, "server_unknown", `unknown MCP server ${server}`);
    return snapshot;
  }

  function connectedOrThrow(method: string, server: string): ServerSnapshot {
    const snapshot = snapshotOrThrow(method, server);
    if (snapshot.state === "blocked") {
      throw mcpError(method, "server_blocked", `MCP server ${server} is blocked`, {
        reason: snapshot.blockedReason ?? "unknown",
      });
    }
    if (snapshot.state !== "connected") {
      throw mcpError(method, "server_disconnected", `MCP server ${server} is ${snapshot.state}`);
    }
    return snapshot;
  }

  // ── 호출 ─────────────────────────────────────────────────────────────────

  async function withConnection<T>(
    method: string,
    server: string,
    work: (connection: NonNullable<ReturnType<ServerRegistry["acquire"]>>) => Promise<T>,
  ): Promise<T> {
    connectedOrThrow(method, server);
    const lease = registry.acquire(server);
    if (lease === undefined) {
      throw mcpError(method, "server_disconnected", `MCP server ${server} is not connected`);
    }
    try {
      return await work(lease);
    } finally {
      lease.release();
    }
  }

  function contentOf(
    blocks: readonly JsonValue[],
    settings: McpSettings,
  ): {
    content: McpContent[];
    truncated: { shownBytes: number; totalBytes: number } | undefined;
  } {
    const converted = convertBlocks(blocks, blobs);
    const limited = limitContent(converted, settings.resultMaxBytes);
    return { content: limited.content, truncated: limited.truncated };
  }

  async function callToolImpl(
    input: CallToolInputValue,
    env: CallEnv,
    continuation: CallToolInputValue["continuation"],
  ): Promise<CallToolOutputValue> {
    const method = "callTool";
    const settings = currentSettings(env.threadId);
    const round = continuation?.round ?? 1;
    checkRound(method, round, settings);
    return await withConnection(method, input.server, async (lease) => {
      const snapshot = snapshotOrThrow(method, input.server);
      if (!snapshot.tools.some((tool) => tool.name === input.tool)) {
        throw mcpError(
          method,
          "tool_unknown",
          `MCP server ${input.server} has no tool ${input.tool}`,
        );
      }
      if (!filterTool(lease.definition.def, input.tool).exposed) {
        throw mcpError(method, "denied", `tool ${input.tool} is hidden by the server definition`);
      }
      const result = await lease.connection.callTool(input.tool, input.arguments, {
        signal: env.signal,
        timeoutMs: callMsOf(lease.definition, settings),
        ...(continuation === undefined
          ? {}
          : {
              continuation: {
                inputResponses: continuation.inputResponses,
                requestState: continuation.requestState,
              },
            }),
      });
      if (!result.ok) throw failureToError(method, result.error, deps.masker);
      if (result.value.kind === "input_required") {
        return inputRequiredOutput(method, input.server, round, result.value, settings);
      }
      const body = contentOf(result.value.content, settings);
      return {
        status: "complete",
        content: body.content,
        ...(result.value.structuredContent === undefined
          ? {}
          : { structuredContent: result.value.structuredContent }),
        isError: result.value.isError,
        ...(body.truncated === undefined ? {} : { truncated: body.truncated }),
      };
    });
  }

  async function getPromptImpl(
    input: GetPromptInputValue,
    env: CallEnv,
  ): Promise<GetPromptOutputValue> {
    const method = "getPrompt";
    const settings = currentSettings(env.threadId);
    const round = input.continuation?.round ?? 1;
    checkRound(method, round, settings);
    return await withConnection(method, input.server, async (lease) => {
      const result = await lease.connection.getPrompt(input.name, input.arguments, {
        signal: env.signal,
        timeoutMs: callMsOf(lease.definition, settings),
        ...(input.continuation === undefined
          ? {}
          : {
              continuation: {
                inputResponses: input.continuation.inputResponses,
                requestState: input.continuation.requestState,
              },
            }),
      });
      if (!result.ok) throw failureToError(method, result.error, deps.masker);
      if (result.value.kind === "input_required") {
        return inputRequiredOutput(method, input.server, round, result.value, settings);
      }
      return {
        status: "complete",
        ...(result.value.description === undefined
          ? {}
          : { description: result.value.description }),
        messages: result.value.messages.map((message) => ({
          role: message.role === "assistant" ? ("assistant" as const) : ("user" as const),
          content: convertBlock(message.content, blobs),
        })),
      };
    });
  }

  async function readResourceImpl(
    input: ReadResourceInputValue,
    env: CallEnv,
  ): Promise<ReadResourceOutputValue> {
    const method = "readResource";
    const settings = currentSettings(env.threadId);
    const round = input.continuation?.round ?? 1;
    checkRound(method, round, settings);
    return await withConnection(method, input.server, async (lease) => {
      const result = await lease.connection.readResource(input.uri, {
        signal: env.signal,
        timeoutMs: callMsOf(lease.definition, settings),
        ...(input.continuation === undefined
          ? {}
          : {
              continuation: {
                inputResponses: input.continuation.inputResponses,
                requestState: input.continuation.requestState,
              },
            }),
      });
      if (!result.ok) throw failureToError(method, result.error, deps.masker);
      if (result.value.kind === "input_required") {
        return inputRequiredOutput(method, input.server, round, result.value, settings);
      }
      const blocks = result.value.contents.map((entry): JsonValue => ({
        type: "resource",
        resource: entry,
      }));
      const body = contentOf(blocks, settings);
      return { status: "complete", contents: body.content };
    });
  }

  // ── 동적 도구 ────────────────────────────────────────────────────────────

  function invoker(
    server: string,
    tool: string,
    args: JsonObject,
    context: McpExecuteContext,
  ): Promise<CallToolOutputValue> {
    const continuation = context.continuation ?? deps.continuations?.take(context.requestId);
    return callToolImpl(
      { server, tool, arguments: args },
      { signal: context.signal, threadId: context.threadId },
      continuation,
    );
  }

  async function applyBoundaryNow(): Promise<BoundaryReport> {
    const settings = loaded?.settings ?? currentSettings();
    const snapshots = registry.list();
    const infos = exposure();
    const desired = new Map<string, McpDynamicTool>();
    for (const snapshot of snapshots) {
      if (snapshot.state !== "connected") continue;
      for (const info of infos.get(snapshot.definition.id) ?? []) {
        const raw = snapshot.tools.find((tool) => tool.name === info.name);
        if (raw === undefined) continue;
        const tool = createDynamicTool(info, raw, snapshot.definition, invoker);
        if (tool !== undefined) desired.set(tool.wire.name, tool);
      }
    }
    const diff = diffToolsets(
      orderedOf([...applied.values()].map((entry) => entry.tool)),
      orderedOf([...desired.values()]),
    );
    const toolsRemoved = diff.removed.map((reference) => reference.name);
    for (const name of toolsRemoved) {
      applied.get(name)?.unregister?.();
      applied.delete(name);
    }
    const toolsAdded: string[] = [];
    for (const wire of diff.added) {
      const tool = desired.get(wire.name);
      if (tool === undefined) continue;
      applied.get(wire.name)?.unregister?.();
      applied.delete(wire.name);
      if (deps.tools === undefined) {
        applied.set(wire.name, { tool, unregister: undefined });
        toolsAdded.push(wire.name);
        continue;
      }
      const registered = deps.tools.register(tool);
      if (!registered.ok) {
        deps.logger.warn("mcp.tool_name_conflict", { server: tool.server, tool: wire.name });
        continue;
      }
      applied.set(wire.name, { tool, unregister: registered.value });
      toolsAdded.push(wire.name);
    }
    // 서버별 fingerprint는 반영된 도구 집합으로 계산한다
    const byServer = new Map<string, McpDynamicTool[]>();
    for (const entry of applied.values()) {
      byServer.set(entry.tool.server, [...(byServer.get(entry.tool.server) ?? []), entry.tool]);
    }
    const prints = await Promise.all(
      snapshots.map(async (snapshot) => ({
        id: snapshot.definition.id,
        print: await toolsetFingerprint(orderedOf(byServer.get(snapshot.definition.id) ?? [])),
      })),
    );
    for (const { id, print } of prints) {
      if (fingerprints.get(id) !== print) {
        fingerprints.set(id, print);
        dirty.add(id);
      }
    }
    for (const id of fingerprints.keys()) {
      if (!snapshots.some((snapshot) => snapshot.definition.id === id)) fingerprints.delete(id);
    }
    const changedServers = [...dirty].toSorted(byteOrder);
    dirty.clear();
    for (const id of changedServers) persist(id);
    const servers = changedServers.map((id) => ({ id, status: changeStatusOf(registry.get(id)) }));
    const ruleTools = [...desired.values()].map((tool) => ({
      server: tool.server,
      name: tool.serverToolName,
      machineName: tool.wire.name,
    }));
    deps.rules?.set(buildApprovalRules(definitions(), ruleTools, settings.approvalMode).rules);
    const changed = servers.length > 0 || toolsAdded.length > 0 || toolsRemoved.length > 0;
    const report: BoundaryReport = { changed, toolsAdded, toolsRemoved, servers };
    if (changed && deps.onServersChange !== undefined) {
      const emit = deps.onServersChange;
      const emitted = attempt(() => emit({ servers, toolsAdded: [...toolsAdded], toolsRemoved }));
      if (!emitted.ok) deps.logger.warn("mcp.change_emit_failed", {});
    }
    return report;
  }

  // ── 서비스 ───────────────────────────────────────────────────────────────

  const client: CapabilityApi<typeof McpClient> = {
    listServers: () =>
      settle(() => ({
        servers: registry
          .list()
          .map(statusOf)
          .toSorted((a, b) => byteOrder(a.server, b.server)),
      })),
    status: ({ server }) => settle(() => statusOf(snapshotOrThrow("status", server))),
    connect: async ({ server }) => {
      snapshotOrThrow("connect", server);
      await registry.connect(server);
      return statusOf(snapshotOrThrow("connect", server));
    },
    reconnect: async ({ server }) => {
      snapshotOrThrow("reconnect", server);
      await registry.reconnect(server);
      return statusOf(snapshotOrThrow("reconnect", server));
    },
    disable: async ({ server }) => {
      snapshotOrThrow("disable", server);
      await registry.disable(server);
      return statusOf(snapshotOrThrow("disable", server));
    },
    listTools: ({ server }) =>
      settle(() => {
        connectedOrThrow("listTools", server);
        return { tools: [...(exposure().get(server) ?? [])] };
      }),
    callTool: (input, options) => callToolImpl(input, envOf(options), input.continuation),
    listPrompts: ({ server }) =>
      settle(() => ({ prompts: promptsOf(server, connectedOrThrow("listPrompts", server)) })),
    getPrompt: (input, options) => getPromptImpl(input, envOf(options)),
    listResources: (input, options) => listResourcesImpl(input, envOf(options)),
    readResource: (input, options) => readResourceImpl(input, envOf(options)),
  };

  async function listOneServer(
    server: string,
    input: ListResourcesInputValue,
    env: CallEnv,
    settings: McpSettings,
  ): Promise<{ resources: ResourceInfo[]; nextCursor: string | undefined } | undefined> {
    const method = "listResources";
    const listed = await attemptAsync(() =>
      withConnection(method, server, async (lease) => {
        const page = await lease.connection.listResources(input.cursor?.[server], {
          signal: env.signal,
          timeoutMs: callMsOf(lease.definition, settings),
        });
        if (!page.ok) throw failureToError(method, page.error, deps.masker);
        return page.value;
      }),
    );
    if (!listed.ok) {
      // 한 서버가 실패해도 다른 서버의 목록은 돌려준다. 서버를 지정했으면 그 오류를 그대로 보인다
      const cause = listed.error.cause;
      if (input.server !== undefined || !(cause instanceof CapabilityError)) throw cause;
      deps.logger.warn("mcp.list_resources_failed", { server, code: cause.data.code });
      return undefined;
    }
    return {
      resources: listed.value.resources.map((resource): ResourceInfo => ({ server, ...resource })),
      nextCursor: listed.value.nextCursor,
    };
  }

  async function listResourcesImpl(
    input: ListResourcesInputValue,
    env: CallEnv,
  ): Promise<ListResourcesOutputValue> {
    const settings = currentSettings(env.threadId);
    const targets =
      input.server === undefined
        ? registry
            .list()
            .filter((snapshot) => snapshot.state === "connected")
            .map((snapshot) => snapshot.definition.id)
            .toSorted(byteOrder)
        : [input.server];
    const resources: ResourceInfo[] = [];
    const nextCursor: Record<string, string> = {};
    await eachAsync(targets, async (server) => {
      const page = await listOneServer(server, input, env, settings);
      if (page === undefined) return undefined;
      resources.push(...page.resources);
      if (page.nextCursor !== undefined) nextCursor[server] = page.nextCursor;
      return undefined;
    });
    return { resources, ...(Object.keys(nextCursor).length === 0 ? {} : { nextCursor }) };
  }

  function registerServer(owner: string, name: string, config: JsonValue): () => void {
    const method = "registerServer";
    if (!new RegExp(MCP_SERVER_ID_PATTERN).test(name)) {
      throw mcpError(
        method,
        "invalid_input",
        `MCP server id ${name} does not match ${MCP_SERVER_ID_PATTERN}`,
      );
    }
    const def = parse(McpServerDefSchema, config);
    if (!def.ok) {
      throw mcpError(method, "invalid_input", `server ${name} has an invalid definition`);
    }
    if (ext.has(name) || (loaded?.servers ?? []).some((server) => server.id === name)) {
      throw mcpError(method, "invalid_input", `MCP server id ${name} is already defined`);
    }
    const extension = owner.split("/")[0] ?? owner;
    const entry = { extension, def: def.value };
    ext.set(name, entry);
    resync();
    return () => {
      if (ext.get(name) !== entry) return;
      ext.delete(name);
      resync();
    };
  }

  const service: McpService = { client, registerServer };

  return {
    service,
    async load(signal) {
      const result = await loadDefinitions(
        {
          layers: deps.settings.layers(undefined),
          projectRoot: deps.projectRoot,
          files: deps.files,
          trust: deps.trust,
          logger: deps.logger,
        },
        signal,
      );
      loaded = result;
      resync();
      return result;
    },
    applyBoundary() {
      // 경계 반영은 한 번에 하나씩만 돈다
      const run = boundaryRunning.then(applyBoundaryNow, applyBoundaryNow);
      boundaryRunning = run;
      return run;
    },
    diagnostics: () => loaded?.diagnostics ?? [],
    settled: () => registry.settled(),
    async shutdown() {
      await registry.shutdown();
      for (const entry of applied.values()) entry.unregister?.();
      applied.clear();
    },
  };
}
