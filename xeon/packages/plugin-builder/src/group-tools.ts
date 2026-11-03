import { parse } from "@fresnel/contracts";
import { toJsonValue, type JsonValue } from "@fresnel/contracts/conversation";
import { CompositionDeclSchema, type ToolResourceDef } from "@fresnel/contracts/extensions";
import type { DevkitError, DevkitService } from "@fresnel/contracts/services";
import { checkGroupName } from "@fresnel/group-sdk";
import { Type, type TSchema } from "typebox";
import { CATALOG_VERSION } from "./catalog.ts";
import { errorKeyOf, sessionOpen, type AuthoringState, type PendingAction } from "./group-state.ts";
import { replayInDevMode } from "./release.ts";

// L3.authoring.spec §3.2 모델 도구 아홉. 도구는 입력 검사, 대화 상태 커밋, 결과 요약만 하고 일은 `fresnel.devkit` 서비스가 한다.
// 사람 확인이 필요한 단계(시험, 묶기, 설치, 고치기 한도)는 도구가 요청(`pending`)만 커밋하고 drive가 `loop.ask`로 확인한 뒤 실행한다(A-4).

export const AUTHORING_TOOL_NAMES = [
  "authoring_kinds",
  "authoring_start",
  "authoring_compose",
  "authoring_scaffold",
  "authoring_validate",
  "authoring_trial",
  "authoring_replay",
  "authoring_package",
  "authoring_install",
] as const;

/** 도구가 쓰는 상태 문서 면. `RegistrationApi`의 부분형이다 */
interface StateAccess {
  state(): Readonly<AuthoringState>;
  commit(next: AuthoringState): Promise<unknown>;
}

export interface ToolsEnv {
  readonly g: StateAccess;
  readonly devkit: DevkitService;
  /** 개발 모드 판정. 호스트 한 곳이 준다(A-5) */
  readonly devMode: () => boolean;
  /** 같은 검사 오류가 남는 고치기 반복 한도(`l3.authoring.fixLoopLimit`, 기본 3) */
  readonly fixLoopLimit: () => number;
}

const sessionShape = { sessionId: Type.String({ minLength: 1, maxLength: 80 }) };

function failure(error: DevkitError): JsonValue {
  return { ok: false, error: { kind: error.kind, message: error.message } };
}

function refusal(reason: string, message: string): JsonValue {
  return { ok: false, error: { kind: reason, message } };
}

function json(value: unknown): JsonValue {
  return toJsonValue(value) ?? null;
}

async function patch(env: ToolsEnv, next: Partial<AuthoringState>): Promise<void> {
  await env.g.commit({ ...env.g.state(), ...next });
}

function checkSession(env: ToolsEnv, sessionId: string): JsonValue | undefined {
  const state = env.g.state();
  if (state.sessionId === null)
    return refusal("no_session", "no authoring session is open: call authoring_start first");
  if (state.sessionId !== sessionId)
    return refusal("unknown_session", `the open session is ${state.sessionId}`);
  if (!sessionOpen(state)) return refusal("session_closed", "the authoring session has ended");
  return undefined;
}

function awaitingIntent(state: Readonly<AuthoringState>): JsonValue | undefined {
  if (state.phase === "intent" || !state.intentConfirmed)
    return refusal("awaiting_confirmation", "the user has not confirmed the kind and the name yet");
  return undefined;
}

type Execute = ToolResourceDef["execute"];

function tool(
  name: (typeof AUTHORING_TOOL_NAMES)[number],
  description: string,
  parameters: TSchema,
  risk: "read" | "write",
  run: (input: Record<string, unknown>) => Promise<JsonValue>,
): ToolResourceDef {
  const execute: Execute = async (args) => {
    const parsed = parse(parameters, args);
    if (!parsed.ok) return refusal("invalid_input", `${name}: the input does not match the schema`);
    const input: Record<string, unknown> =
      typeof args === "object" && args !== null && !Array.isArray(args)
        ? Object.fromEntries(Object.entries(args))
        : {};
    return run(input);
  };
  return { name, description, parameters, replay: "unsafe", risk, execute };
}

function str(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  return typeof value === "string" ? value : "";
}

function optStr(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" ? value : undefined;
}

/** 요청 하나를 pending으로 올리거나 지난 결과를 돌려준다. 거절 뒤 첫 호출은 거절을 알리고, 다음 호출이 다시 묻는다 */
async function request(
  env: ToolsEnv,
  action: Exclude<PendingAction, "fix_limit">,
  done: JsonValue | undefined,
  extra: Partial<AuthoringState> = {},
): Promise<JsonValue> {
  const state = env.g.state();
  if (state.pending === action) return { ok: true, status: "awaiting_confirmation", action };
  if (state.pending !== null)
    return refusal("busy", `the user is still confirming ${state.pending}`);
  if (state.denied === action) {
    await patch(env, { denied: null });
    return { ok: false, status: "denied", action, hint: "call again to ask the user again" };
  }
  if (done !== undefined) return { ok: true, status: "done", action, result: done };
  await patch(env, { pending: action, askRound: state.askRound + 1, ...extra });
  return { ok: true, status: "awaiting_confirmation", action };
}

export function authoringTools(env: ToolsEnv): readonly ToolResourceDef[] {
  const { devkit } = env;

  const kinds = tool(
    "authoring_kinds",
    "List the kinds of extension that can be built, with their status and the decisions the author must make.",
    Type.Object(
      { layer: Type.Optional(Type.String()), query: Type.Optional(Type.String()) },
      { additionalProperties: false },
    ),
    "read",
    async (input) => {
      const layer = optStr(input, "layer");
      const query = optStr(input, "query")?.toLowerCase();
      const entries = (await devkit.kinds()).filter(
        (entry) =>
          (layer === undefined || entry.layers.some((found) => found === layer)) &&
          (query === undefined || `${entry.id} ${entry.title}`.toLowerCase().includes(query)),
      );
      return {
        ok: true,
        catalogVersion: CATALOG_VERSION,
        kinds: entries.map((entry) =>
          json({
            id: entry.id,
            title: entry.title,
            status: entry.status,
            decisions: entry.decisions,
            ...(entry.blockedReason === undefined ? {} : { blockedReason: entry.blockedReason }),
          }),
        ),
      };
    },
  );

  const start = tool(
    "authoring_start",
    "Open an authoring session for one extension. The user confirms the kind and the name before the next steps.",
    Type.Object(
      {
        kind: Type.Union([Type.Literal("single-plugin"), Type.Literal("plugin-group")]),
        name: Type.String({ minLength: 1, maxLength: 64 }),
        dir: Type.String({ minLength: 1, maxLength: 1024 }),
        displayName: Type.Optional(Type.String({ maxLength: 120 })),
      },
      { additionalProperties: false },
    ),
    "read",
    async (input) => {
      const state = env.g.state();
      if (sessionOpen(state))
        return refusal("session_open", `finish or stop the open session ${state.sessionId ?? ""}`);
      const name = str(input, "name");
      const kindId = str(input, "kind");
      const entry = (await devkit.kinds()).find((found) => found.id === kindId);
      if (entry === undefined) return refusal("unknown_kind", `no kind ${kindId}`);
      if (entry.status === "blocked")
        return refusal("blocked_kind", entry.blockedReason ?? `${kindId} is blocked`);
      const checked = checkGroupName(name);
      if (!checked.ok)
        return refusal("invalid_name", `name ${name} is not allowed (${checked.error.reason})`);
      const kind = entry.id;
      const sessionId = `auth-${name}`;
      await env.g.commit({
        ...env.g.state(),
        phase: "intent",
        sessionId,
        kind,
        name,
        dir: str(input, "dir"),
        displayName: optStr(input, "displayName") ?? null,
        intentConfirmed: false,
        composition: null,
        files: [],
        lastErrorKey: null,
        sameErrorRuns: 0,
        pending: null,
        packOut: null,
        replay: "none",
        trial: null,
        packaged: null,
        installed: null,
        denied: null,
        askRound: 0,
      });
      return {
        ok: true,
        sessionId,
        nameCheck: { ok: true },
        awaiting: "user confirmation of kind and name",
      };
    },
  );

  const compose = tool(
    "authoring_compose",
    "Save the composition draft of the extension and check it.",
    Type.Object(
      { ...sessionShape, composition: CompositionDeclSchema },
      { additionalProperties: false },
    ),
    "read",
    async (input) => {
      const refused = checkSession(env, str(input, "sessionId")) ?? awaitingIntent(env.g.state());
      if (refused !== undefined) return refused;
      const draft = parse(CompositionDeclSchema, input["composition"]);
      if (!draft.ok) return refusal("invalid_input", "the composition does not match the schema");
      const report = devkit.validateComposition(draft.value);
      if (report.ok) await patch(env, { phase: "compose", composition: draft.value });
      return { ok: report.ok, saved: report.ok, report: json(report) };
    },
  );

  const scaffold = tool(
    "authoring_scaffold",
    "Create the files of the extension in the target folder from the template and the composition draft.",
    Type.Object(sessionShape, { additionalProperties: false }),
    "write",
    async (input) => {
      const refused = checkSession(env, str(input, "sessionId")) ?? awaitingIntent(env.g.state());
      if (refused !== undefined) return refused;
      const state = env.g.state();
      if (state.kind === null || state.name === null || state.dir === null)
        return refusal("no_session", "the session has no kind, name or folder");
      if (state.files.length > 0)
        return refusal(
          "exists",
          "the files were already created: edit them and call authoring_validate",
        );
      const made = await devkit.scaffold({
        kind: state.kind,
        name: state.name,
        dir: state.dir,
        ...(state.composition === null ? {} : { group: { composition: state.composition } }),
      });
      if (!made.ok) return failure(made.error);
      await patch(env, {
        phase: "validate",
        files: [...made.value.files],
        packaged: null,
        installed: null,
      });
      return { ok: true, dir: made.value.dir, files: [...made.value.files] };
    },
  );

  const validate = tool(
    "authoring_validate",
    "Check the extension (manifest, composition, drive replay rules, authoring rules).",
    Type.Object(sessionShape, { additionalProperties: false }),
    "read",
    async (input) => {
      const refused = checkSession(env, str(input, "sessionId")) ?? awaitingIntent(env.g.state());
      if (refused !== undefined) return refused;
      const state = env.g.state();
      if (state.dir === null || state.files.length === 0)
        return refusal("not_scaffolded", "call authoring_scaffold first");
      if (state.pending === "fix_limit")
        return refusal(
          "awaiting_confirmation",
          "the same errors remain: the user decides whether to continue",
        );
      const checked = await devkit.validate(state.dir);
      if (!checked.ok) return failure(checked.error);
      const report = checked.value;
      const key = errorKeyOf(report.issues);
      const base = { packaged: null, installed: null };
      if (key === null) {
        await patch(env, {
          ...base,
          phase: state.phase === "replay" ? "replay" : "trial",
          lastErrorKey: null,
          sameErrorRuns: 0,
        });
        return { ok: true, report: json(report) };
      }
      const runs = key === state.lastErrorKey ? state.sameErrorRuns + 1 : 1;
      const limit = runs >= env.fixLoopLimit();
      await patch(env, {
        ...base,
        phase: "fix",
        lastErrorKey: key,
        sameErrorRuns: runs,
        ...(limit ? { pending: "fix_limit", askRound: state.askRound + 1 } : {}),
      });
      return {
        ok: false,
        report: json(report),
        ...(limit
          ? { stopped: "the same errors remain: asking the user whether to continue" }
          : {}),
      };
    },
  );

  const trial = tool(
    "authoring_trial",
    "Start a Test run of the extension. The user confirms before it starts (cost).",
    Type.Object(
      {
        ...sessionShape,
        profile: Type.Optional(Type.String()),
        prompt: Type.String({ maxLength: 4000 }),
      },
      { additionalProperties: false },
    ),
    "write",
    async (input) => {
      const refused = checkSession(env, str(input, "sessionId")) ?? awaitingIntent(env.g.state());
      if (refused !== undefined) return refused;
      const state = env.g.state();
      if (
        state.phase === "validate" ||
        state.phase === "fix" ||
        state.phase === "scaffold" ||
        state.phase === "compose"
      )
        return refusal("not_validated", "the extension must pass authoring_validate first");
      return request(env, "trial", state.trial === null ? undefined : json(state.trial));
    },
  );

  const replay = tool(
    "authoring_replay",
    "Replay the drive of the extension (development mode only).",
    Type.Object(
      { ...sessionShape, maxCommits: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })) },
      { additionalProperties: false },
    ),
    "read",
    async (input) => {
      const refused = checkSession(env, str(input, "sessionId")) ?? awaitingIntent(env.g.state());
      if (refused !== undefined) return refused;
      const state = env.g.state();
      if (state.dir === null) return refusal("no_session", "the session has no folder");
      const maxCommits = input["maxCommits"];
      const ran = await replayInDevMode(
        env.devMode(),
        (replayInput) => devkit.replay(replayInput),
        {
          target: state.dir,
          ...(typeof maxCommits === "number" ? { maxCommits } : {}),
        },
      );
      if (!ran.ok) {
        if (ran.error.kind === "dev_mode_required")
          await patch(env, { replay: "dev_mode_required" });
        return failure(ran.error);
      }
      await patch(env, { replay: ran.value.ok ? "passed" : "failed", phase: "replay" });
      return { ok: ran.value.ok, report: json(ran.value) };
    },
  );

  const pack = tool(
    "authoring_package",
    "Pack the extension into one installable bundle. The user confirms before anything is written.",
    Type.Object(
      { ...sessionShape, out: Type.Optional(Type.String({ maxLength: 1024 })) },
      { additionalProperties: false },
    ),
    "write",
    async (input) => {
      const refused = checkSession(env, str(input, "sessionId")) ?? awaitingIntent(env.g.state());
      if (refused !== undefined) return refused;
      const state = env.g.state();
      if (state.phase !== "trial" && state.phase !== "replay" && state.phase !== "package")
        return refusal("not_validated", "the extension must pass authoring_validate first");
      const out = optStr(input, "out");
      return request(env, "package", state.packaged === null ? undefined : json(state.packaged), {
        packOut: out ?? null,
      });
    },
  );

  const install = tool(
    "authoring_install",
    "Install the packed bundle in the user extension location. The user confirms before it is linked.",
    Type.Object({ ...sessionShape, scope: Type.Literal("user") }, { additionalProperties: false }),
    "write",
    async (input) => {
      const refused = checkSession(env, str(input, "sessionId")) ?? awaitingIntent(env.g.state());
      if (refused !== undefined) return refused;
      const state = env.g.state();
      if (state.packaged === null) return refusal("not_packaged", "call authoring_package first");
      return request(env, "install", state.installed === null ? undefined : json(state.installed));
    },
  );

  return [kinds, start, compose, scaffold, validate, trial, replay, pack, install];
}
