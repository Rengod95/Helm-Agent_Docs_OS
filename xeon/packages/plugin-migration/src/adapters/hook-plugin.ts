// Hook 플러그인의 코드와 데이터를 만든다(migration.md §4.3.5, 템플릿 `adapter-hooks`). 결정적이다: 같은 입력이면 같은 바이트다.
// 생성된 `plugin.js`는 `export const extension = ({ register })` 형식이고 `register(이름, {}, setup)`으로 등록한다. setup은
// `g.on(지점, 핸들러)`로 지점을 걸고 `g.runScript(이름, { stdin })`로 스크립트를 부른다(F.extensions §3.1.4, ext-host child-api).
// 템플릿 본문은 원본 매처 판정(정확 목록, `*`와 빈 값, 정규식), 입력 모양 변환, 종료 코드와 출력의 결정 변환을 한다.
import type { PluginScriptEnvDecl } from "../types.ts";

/** 템플릿 버전. 생성물 첫 줄과 `ADAPTER` 상수에 적는다. 본문이나 머리 주석을 바꾸면 올린다 */
export const HOOK_ADAPTER = "adapter-hooks@5";

/** `plugin.js`가 가진 Hook 항목 하나. `script`는 매니페스트 `scripts`의 이름이다 */
export interface HookEntryData {
  readonly event: string;
  /** 매처 원문. 모든 도구에 맞으면 null(매처 없음, `*`, 빈 값) */
  readonly matcher: string | null;
  readonly script: string;
}

/**
 * 매니페스트 `scripts`의 한 선언. 파일은 플러그인 폴더 기준이다. 모든 Hook 명령은 환경 모드다(AGE-58 사용자 결정 2026-11-20):
 * `file`(명령 원문을 담은 동반 파일)의 명령을 `env.shell`로 원래 환경에서 돌린다. 스크립트는 복사하지 않는다.
 */
export interface HookScriptDecl {
  readonly name: string;
  readonly runner: PluginScriptEnvDecl["shell"];
  readonly file: string;
  readonly timeoutMs: number;
  readonly env: PluginScriptEnvDecl;
}

const HEAD = [
  "// 가져온 Claude Code 훅 설정으로 만든 플러그인 코드다. 손으로 고치지 않는다: 원본이 바뀌면 다시 가져온다.",
  "// 각 스크립트는 원래 훅 명령 원문을 매니페스트(scripts[].env)에 싣고 원래 환경에서 돌린다. g.runScript로 부르고, 매처, 입력 모양, 종료 코드, 출력을 원본과 맞춘다.",
].join("\n");

// 본문은 String.raw로 둔다: 정규식과 이스케이프가 원문 그대로 생성물에 들어간다. `${`와 백틱은 쓰지 않는다.
const BODY = String.raw`
const REASON_MAX = 500;
const DEFAULT_REASON = "훅이 막았다";
const UNSUPPORTED_INPUT = "입력을 바꾸려 했으나 지원하지 않는다";
const UNRUNNABLE_INPUT = "입력이 너무 커서 훅 스크립트를 돌리지 못했다. 사람이 확인한다";
const STDERR_LINE_MAX = 160;
const EXACT_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_- ,|";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// 원본 판정: 글자, 숫자, _, -, 공백, ",", "|"만 있으면 정확 일치 목록이다. 그 밖은 정규식(앵커 없음)이다.
function isExactList(matcher) {
  for (const ch of matcher) {
    if (EXACT_CHARS.indexOf(ch) < 0 && ch !== "\t" && ch !== "\n" && ch !== "\r") return false;
  }
  return true;
}

function matcherMatches(matcher, name) {
  if (matcher === null || matcher === "*" || matcher === "") return true;
  if (isExactList(matcher)) {
    return matcher
      .split(/[|,]/)
      .map((part) => part.trim())
      .filter((part) => part !== "")
      .indexOf(name) >= 0;
  }
  try {
    return new RegExp(matcher).test(name);
  } catch (error) {
    return false;
  }
}

function claudeNameOf(toolName) {
  return Object.prototype.hasOwnProperty.call(TOOL_NAMES, toolName) ? TOOL_NAMES[toolName] : toolName;
}

// Fresnel 도구 입력을 원본 도구의 입력 모양으로 바꾼다. 시간 제한은 초에서 밀리초로 바꾼다.
function claudeToolInput(toolName, input) {
  const source = isPlainObject(input) ? input : {};
  if (toolName === "bash") {
    const out = { command: source.command };
    if (typeof source.timeout === "number") out.timeout = Math.round(source.timeout * 1000);
    return out;
  }
  if (toolName === "read") return { file_path: source.path, offset: source.offset, limit: source.limit };
  if (toolName === "write") return { file_path: source.path, content: source.content };
  if (toolName === "edit") {
    const pairs = (Array.isArray(source.edits) ? source.edits : []).map((edit) => ({
      old_string: edit.oldText,
      new_string: edit.newText,
    }));
    if (pairs.length === 1) {
      return { file_path: source.path, old_string: pairs[0].old_string, new_string: pairs[0].new_string };
    }
    return { file_path: source.path, edits: pairs };
  }
  return Object.assign({}, source);
}

function parseObject(text) {
  if (typeof text !== "string" || text.trim() === "") return undefined;
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return undefined;
  }
  return isPlainObject(value) ? value : undefined;
}

function reasonOf(...candidates) {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim() !== "") return candidate.trim().slice(0, REASON_MAX);
  }
  return DEFAULT_REASON;
}

// 돌리지 못한 것을 묻는 말로 만든다. 사용자가 보는 문장이므로 REASON_MAX 글자 안으로 자른다.
function capped(text) {
  return text.slice(0, REASON_MAX);
}

function passOutcome() {
  return { verdict: "pass", reason: "", context: "" };
}

// 실행하지 못한 훅의 결정이다. noted는 도구 결과 지점에도 사유를 붙인다는 뜻이다(256 KiB 거절은 붙이지 않는다)
function unrunnableOutcome(detail) {
  return {
    verdict: "unrunnable",
    reason: capped("훅을 돌릴 수 없어요: " + detail + ". 계속할까요?"),
    context: "",
    noted: true,
  };
}

// 스크립트를 띄우지 못한 이유를 묻는 말로 바꾼다(AGE-58 사용자 결정 2026-11-20 (2)). 돌리지 못한 훅을 조용히 통과시키지 않는다.
// 재생 거절과 승인 카드의 거절은 사람이 정했거나 재생이 정한 결과라 통과다. 알 수 없는 종류도 묻는다.
function refusalOutcome(error) {
  const kind = isPlainObject(error) && typeof error.kind === "string" ? error.kind : "unknown";
  if (kind === "replay_mode_denied" || kind === "script_denied") return passOutcome();
  if (kind === "script_ref_changed") {
    const state = error.reason === "missing" ? "없어요" : error.reason === "unreadable" ? "읽을 수 없어요" : "바뀌었어요";
    const path = typeof error.path === "string" ? error.path : "";
    return unrunnableOutcome("스크립트 " + path + "가 " + state + ". 가져오기를 다시 해야 해요");
  }
  if (kind === "spawn_failed") {
    const code = typeof error.code === "string" && error.code !== "" ? "(" + error.code + ")" : "";
    return unrunnableOutcome("띄우지 못했어요" + code);
  }
  if (kind === "sandbox_unavailable") return unrunnableOutcome("이 기기에서 샌드박스를 쓸 수 없어요");
  if (kind === "script_env_not_granted") return unrunnableOutcome("이 훅은 환경 모드를 받을 수 없어요");
  // script_missing, script_outside_tree, script_not_declared, script_not_approved와 그 밖의 종류는 종류 이름을 적는다
  return unrunnableOutcome(kind);
}

function firstLineOf(text) {
  if (typeof text !== "string") return "";
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed !== "") return trimmed.slice(0, STDERR_LINE_MAX);
  }
  return "";
}

// 명령을 찾지 못했거나(127) 실행하지 못한(126) 것. 표준 오류의 첫 줄을 쓰고, 없으면 종료 코드로 말한다.
function missingToolDetail(run) {
  const line = firstLineOf(run.stderr);
  if (line !== "") return line;
  return run.exitCode === 127 ? "명령을 찾을 수 없어요(127)" : "실행할 수 없어요(126)";
}

// 실행 결과 하나를 결정으로 바꾼다. 종료 코드 2는 막기, 0과 JSON 출력은 막기, 묻기, 입력 변경(묻기로), 통과다.
// 실행 결과가 거절이면(실행하지 못함) 이유에 따라 묻거나 통과한다(refusalOutcome). 종료 코드 127과 126은 돌리지 못한 것이라 묻는다.
// 기한, 신호, 그 밖의 종료 코드, JSON이 아닌 출력은 통과다(원본이 막지 않는 오류로 보는 것과 같다).
function outcomeOf(result) {
  if (!isPlainObject(result)) return passOutcome();
  if (result.ok !== true) return refusalOutcome(result.error);
  const run = result.value;
  if (run.timedOut === true || run.exitCode === null) return passOutcome();
  if (run.exitCode === 2) return { verdict: "block", reason: reasonOf(run.stderr), context: "" };
  if (run.exitCode === 127 || run.exitCode === 126) return unrunnableOutcome(missingToolDetail(run));
  if (run.exitCode !== 0) return passOutcome();
  const json = parseObject(run.stdout);
  if (json === undefined) return passOutcome();
  const specific = isPlainObject(json.hookSpecificOutput) ? json.hookSpecificOutput : {};
  const context = typeof specific.additionalContext === "string" ? specific.additionalContext : "";
  if (specific.permissionDecision === "deny") {
    return { verdict: "block", reason: reasonOf(specific.permissionDecisionReason, json.reason), context };
  }
  if (json.decision === "block") return { verdict: "block", reason: reasonOf(json.reason), context };
  if (specific.updatedInput !== undefined) return { verdict: "ask", reason: UNSUPPORTED_INPUT, context };
  if (specific.permissionDecision === "ask") {
    return { verdict: "ask", reason: reasonOf(specific.permissionDecisionReason, json.reason), context };
  }
  return { verdict: "pass", reason: "", context };
}

function entriesFor(eventName, matchName) {
  return ENTRIES.filter(
    (entry) => entry.event === eventName && (entry.matcher === null || matcherMatches(entry.matcher, matchName)),
  );
}

// 엔진은 표준 입력이 상한을 넘은 호출을 invalid_params로 거절하고, 거절은 값이 아니라 던져진다. 그 던짐만 여기서 받는다.
// 스크립트를 돌리지 못한 것이라 "unrunnable"이다: 막는 지점은 묻기로 바꾸고, 나머지 지점은 통과로 둔다. 다른 던짐은 그대로 다시 던진다.
async function runOne(g, script, stdin) {
  let result;
  try {
    result = await g.runScript(script, { stdin });
  } catch (error) {
    if (isPlainObject(error) && error.kind === "invalid_params") {
      return { verdict: "unrunnable", reason: UNRUNNABLE_INPUT, context: "", noted: false };
    }
    throw error;
  }
  return outcomeOf(result);
}

// 같은 이벤트에 걸린 훅은 원본처럼 함께 돈다. 결과는 등록 순서를 지킨다.
async function runAll(g, eventName, matchName, input) {
  const stdin = JSON.stringify(input);
  return Promise.all(entriesFor(eventName, matchName).map((entry) => runOne(g, entry.script, stdin)));
}

function firstOf(outcomes, verdict) {
  return outcomes.find((outcome) => outcome.verdict === verdict);
}

function contentText(content) {
  return (Array.isArray(content) ? content : [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function handlersOf(g, continued) {
  return {
    "tool.call.before": async (payload, ctx) => {
      const name = claudeNameOf(payload.toolName);
      const outcomes = await runAll(g, "PreToolUse", name, {
        session_id: ctx.threadId,
        hook_event_name: "PreToolUse",
        tool_name: name,
        tool_input: claudeToolInput(payload.toolName, payload.input),
        tool_use_id: payload.toolCallId,
      });
      const blocked = firstOf(outcomes, "block");
      if (blocked !== undefined) return { block: true, reason: blocked.reason };
      const asked = firstOf(outcomes, "ask") ?? firstOf(outcomes, "unrunnable");
      if (asked !== undefined) return { ask: true, reason: asked.reason };
      return undefined;
    },
    "tool.result": async (payload, current, ctx) => {
      const name = claudeNameOf(payload.toolName);
      const outcomes = await runAll(g, "PostToolUse", name, {
        session_id: ctx.threadId,
        hook_event_name: "PostToolUse",
        tool_name: name,
        tool_input: claudeToolInput(payload.toolName, payload.input),
        tool_use_id: payload.toolCallId,
        tool_response: { text: contentText(current.content), isError: current.isError === true },
      });
      // 실행하지 못한 훅의 사유도 결과 본문 뒤에 붙여 사용자가 보게 한다(noted). 도구는 이미 실행되었으므로 막지 않는다.
      // 256 KiB 거절(noted가 거짓)은 이 자리에서 아무것도 더하지 않는다(migration.md §4.3.5)
      const notes = [];
      for (const outcome of outcomes) {
        if (outcome.verdict === "block" || outcome.verdict === "ask") notes.push(outcome.reason);
        if (outcome.verdict === "unrunnable" && outcome.noted === true) notes.push(outcome.reason);
        if (outcome.context !== "") notes.push(outcome.context);
      }
      if (notes.length === 0) return undefined;
      return { content: current.content.concat([{ type: "text", text: notes.join("\n") }]) };
    },
    // 돌리지 못한 훅(unrunnable)은 이 자리에서 묻지도 막지도 않는다: 입력은 그대로 간다(묻는 자리가 아니다)
    "input.user.before": async (payload, current, ctx) => {
      const outcomes = await runAll(g, "UserPromptSubmit", undefined, {
        session_id: ctx.threadId,
        hook_event_name: "UserPromptSubmit",
        prompt: payload.text,
      });
      if (firstOf(outcomes, "block") !== undefined) return { action: "handled" };
      return undefined;
    },
    // 돌리지 못한 훅(unrunnable)은 멈추지 말고 계속하게 하지 않는다: 턴은 그대로 끝난다(묻는 자리가 아니다)
    "boundary.settle.before": async (payload, current, ctx) => {
      if (current.continue === true) return undefined;
      const key = String(payload.turnId);
      const outcomes = await runAll(g, "Stop", undefined, {
        session_id: ctx.threadId,
        hook_event_name: "Stop",
        stop_hook_active: continued.has(key),
      });
      if (firstOf(outcomes, "block") !== undefined) {
        continued.add(key);
        return { continue: true };
      }
      continued.delete(key);
      return undefined;
    },
    // 돌리지 못한 훅(unrunnable)은 지켜보기만 하는 자리라 아무것도 하지 않는다(통과)
    "thread.start": async (payload, ctx) => {
      await runAll(g, "SessionStart", "startup", {
        session_id: ctx.threadId,
        hook_event_name: "SessionStart",
        source: "startup",
      });
    },
  };
}

export const adapter = ADAPTER;

export const extension = ({ register }) => {
  register(PLUGIN, {}, (g) => {
    const continued = new Set();
    const handlers = handlersOf(g, continued);
    for (const position of POSITIONS) {
      g.on(position, handlers[position]);
    }
  });
};
`;

/** `plugin.js`를 만든다. 데이터는 값으로 싣는다(가져오기 파일을 읽지 않는다) */
export function hookPluginJs(input: {
  readonly plugin: string;
  readonly positions: readonly string[];
  readonly entries: readonly HookEntryData[];
  readonly toolNames: Readonly<Record<string, string>>;
}): string {
  return [
    HEAD,
    `const ADAPTER = ${JSON.stringify(HOOK_ADAPTER)};`,
    `const PLUGIN = ${JSON.stringify(input.plugin)};`,
    `const POSITIONS = ${JSON.stringify(input.positions)};`,
    `const ENTRIES = ${JSON.stringify(input.entries, null, 2)};`,
    `const TOOL_NAMES = ${JSON.stringify(input.toolNames, null, 2)};`,
    BODY,
  ].join("\n");
}
