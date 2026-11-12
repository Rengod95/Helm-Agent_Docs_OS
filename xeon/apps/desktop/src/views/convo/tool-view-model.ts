import { assertNever } from "@fresnel/contracts";
import { t, type MessageId } from "@fresnel/client/i18n";
import { NOT_STARTED_TEXT, OUTCOME_UNKNOWN_TEXT } from "@fresnel/contracts/records";
import type { ItemRecord, JsonObject, JsonValue } from "@fresnel/contracts/conversation";
import {
  previewOf,
  summarizeToolArgs,
  type ToolArgsSummary,
} from "../../state/engine/tool-summary.ts";
import { hookDenialOf, isUserDenial, type HookDenialView } from "../hook-denial-model.ts";
import { sandboxBlocksOf, type SandboxBlockView } from "../sandbox-block-model.ts";
import { toolOutputOf } from "../tool-output-model.ts";

// 도구 줄 하나의 화면 값(dzT2a 시안 3.3, 4절). 순수 함수이고 화면 없이 시험한다.
// 머리(아이콘·동사·대상)는 인자 요약(`tool-summary.ts`)에서, 상태(끝남·실패 종류)는 결과 item의 details에서 읽는다.
// 엔진이 모델에 주는 영어 문장(거부, 중단, 계획 모드 아님)은 여기서 화면 문구로 바꾼다. 모델에 가는 글은 그대로다.

/** 줄 머리 아이콘. 부품이 caustic 아이콘으로 바꾼다 */
export type ToolIcon =
  | "read"
  | "list"
  | "search"
  | "command"
  | "edit"
  | "write"
  | "web"
  | "mcp"
  | "memory"
  | "skill"
  | "tasks"
  | "agent"
  | "plan"
  | "other";

/** 동사 뒤 대상 */
export type ToolTarget =
  | { readonly kind: "path"; readonly path: string; readonly suffix: string | null }
  | { readonly kind: "command"; readonly text: string }
  | { readonly kind: "text"; readonly text: string; readonly mono: boolean }
  | { readonly kind: "none" };

export type ToolHead = {
  readonly icon: ToolIcon;
  /** 끝났거나 실패한 줄의 동사(과거형) */
  readonly verb: string;
  /** 실행 중 동사(현재형) */
  readonly verbRunning: string;
  readonly target: ToolTarget;
  /** MCP 도구의 서버 이름. 대상 앞에 배지로 선다 */
  readonly server: string | null;
  /** 조용한 줄(기억·스킬): 동사가 흐리고 끝 체크를 두지 않는다 */
  readonly quiet: boolean;
  /** 동사 대신 도구 이름 mono를 쓰는 줄(표에 없는 도구, 확장 도구) */
  readonly rawName: boolean;
};

const MEMORY_VERB: Readonly<Record<"add" | "replace" | "remove" | "batch", MessageId>> = {
  add: "desktop.convo.tool.memory.add",
  replace: "desktop.convo.tool.memory.replace",
  remove: "desktop.convo.tool.memory.remove",
  batch: "desktop.convo.tool.memory.batch",
};

function head(
  icon: ToolIcon,
  done: MessageId,
  running: MessageId,
  target: ToolTarget,
  extra?: Partial<Pick<ToolHead, "server" | "quiet" | "rawName">>,
): ToolHead {
  return {
    icon,
    verb: t(done),
    verbRunning: t(running),
    target,
    server: extra?.server ?? null,
    quiet: extra?.quiet ?? false,
    rawName: extra?.rawName ?? false,
  };
}

function rangeOf(
  range: { readonly offset: number | null; readonly limit: number | null } | null,
): string | null {
  if (range === null) return null;
  const from = range.offset ?? 1;
  return range.limit === null ? `:${from}-` : `:${from}-${from + range.limit - 1}`;
}

function hostOf(url: string): string {
  if (!URL.canParse(url)) return url;
  return new URL(url).hostname.replace(/^www\./, "");
}

const SKILL_TOOLS: ReadonlySet<string> = new Set(["skill_view", "skill_manage"]);

/** MCP 도구 이름에서 `mcp__<서버>__` 접두를 뗀다(서버는 배지가 따로 보인다) */
function mcpToolName(summary: { readonly server: string; readonly tool: string }): string {
  const prefix = `mcp__${summary.server}__`;
  return summary.tool.startsWith(prefix) ? summary.tool.slice(prefix.length) : summary.tool;
}

/** 인자 요약을 줄 머리로 바꾼다 */
export function toolHeadOf(name: string, args: JsonObject, server: string | null): ToolHead {
  const summary: ToolArgsSummary = summarizeToolArgs(name, args, server);
  switch (summary.kind) {
    case "read":
      if (SKILL_TOOLS.has(name)) {
        return head(
          "skill",
          "desktop.convo.tool.skill",
          "desktop.convo.tool.skill.running",
          {
            kind: "text",
            text: summary.path,
            mono: false,
          },
          { quiet: true },
        );
      }
      return head("read", "desktop.convo.tool.read", "desktop.convo.tool.read.running", {
        kind: "path",
        path: summary.path,
        suffix: rangeOf(summary.range),
      });
    case "list":
      return head(
        "list",
        "desktop.convo.tool.list",
        "desktop.convo.tool.list.running",
        summary.path === null
          ? { kind: "text", text: t("desktop.convo.tool.workFolder"), mono: false }
          : { kind: "path", path: summary.path, suffix: null },
      );
    case "search": {
      const where = summary.path === null ? "" : ` · ${summary.path}`;
      const glob = summary.glob === null ? "" : ` (${summary.glob})`;
      return head("search", "desktop.convo.tool.search", "desktop.convo.tool.search.running", {
        kind: "text",
        text: `${summary.pattern}${glob}${where}`,
        mono: summary.target !== "knowledge",
      });
    }
    case "command":
      return head("command", "desktop.convo.tool.command", "desktop.convo.tool.command.running", {
        kind: "command",
        text: summary.command,
      });
    case "edit":
      return head("edit", "desktop.convo.tool.edit", "desktop.convo.tool.edit.running", {
        kind: "path",
        path: summary.path,
        suffix: null,
      });
    case "write":
      return head("write", "desktop.convo.tool.write", "desktop.convo.tool.write.running", {
        kind: "path",
        path: summary.path,
        suffix: null,
      });
    case "web": {
      if (summary.op === "search" || summary.op === "research") {
        return head("web", "desktop.convo.tool.webSearch", "desktop.convo.tool.webSearch.running", {
          kind: "text",
          text: summary.query ?? "",
          mono: false,
        });
      }
      const url = summary.urls[0];
      return head(
        "web",
        "desktop.convo.tool.webRead",
        "desktop.convo.tool.webRead.running",
        url === undefined
          ? { kind: "text", text: summary.query ?? "", mono: false }
          : {
              kind: "path",
              path: hostOf(url),
              suffix: summary.urls.length > 1 ? ` +${summary.urls.length - 1}` : null,
            },
      );
    }
    case "mcp":
      return head(
        "mcp",
        "desktop.convo.tool.mcp",
        "desktop.convo.tool.mcp.running",
        {
          kind: "text",
          text:
            summary.args === "{}"
              ? mcpToolName(summary)
              : `${mcpToolName(summary)} ${summary.args}`,
          mono: true,
        },
        { server: summary.server },
      );
    case "memory": {
      if (name === "skill_manage") {
        return head(
          "skill",
          "desktop.convo.tool.skillManage",
          "desktop.convo.tool.skillManage.running",
          {
            kind: "text",
            text: summary.entryId ?? summary.text ?? "",
            mono: false,
          },
          { quiet: true },
        );
      }
      const text =
        summary.op === "batch"
          ? t("desktop.convo.tool.memory.items", { count: summary.ops.length })
          : (summary.text ?? summary.entryId ?? "");
      return head(
        "memory",
        MEMORY_VERB[summary.op],
        "desktop.convo.tool.memory.running",
        {
          kind: "text",
          text: previewOf(text.replace(/\s+/g, " "), 120),
          mono: false,
        },
        { quiet: true },
      );
    }
    case "tasks":
      return head("tasks", "desktop.convo.tool.tasks", "desktop.convo.tool.tasks.running", {
        kind: "none",
      });
    case "agent":
      return head("agent", "desktop.convo.tool.agent", "desktop.convo.tool.agent.running", {
        kind: "text",
        text: previewOf((summary.task.split("\n")[0] ?? "").trim(), 120),
        mono: false,
      });
    case "generic":
      if (name === "submit_plan") {
        return head("plan", "desktop.convo.tool.plan", "desktop.convo.tool.plan.running", {
          kind: "none",
        });
      }
      return {
        icon: "other",
        verb: name,
        verbRunning: name,
        target:
          summary.text === "{}"
            ? { kind: "none" }
            : { kind: "text", text: summary.text, mono: true },
        server: null,
        quiet: false,
        rawName: true,
      };
    default:
      return assertNever(summary, "ToolArgsSummary");
  }
}

// ── 결과 ──────────────────────────────────────────────────────────────

/** 실패 종류. 색과 문구가 다르다(시안 4절) */
export type FailureKind =
  | "failed"
  | "denied"
  | "interrupted"
  | "hookBlocked"
  | "hookThrew"
  | "guard"
  | "sandbox";

export type ToolOutcome =
  | { readonly kind: "done" }
  | { readonly kind: "failed"; readonly failure: FailureKind };

export type ToolResultView = {
  readonly outcome: ToolOutcome;
  /** 상세에 보일 글(엔진의 영어 안내는 화면 문구로 바꿨다). 빈 글이면 상세 글이 없다 */
  readonly output: string;
  readonly cut: { readonly shown: number; readonly total: number } | null;
  readonly hook: HookDenialView | null;
  readonly blocks: readonly SandboxBlockView[];
  /** bash: 종료 코드와 걸린 시간(details에 있을 때만) */
  readonly exitCode: number | null;
  readonly durationMs: number | null;
  /** MCP 서버 이름(`details.server`) */
  readonly server: string | null;
};

function isObject(value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberAt(details: JsonValue | undefined, key: string): number | null {
  if (!isObject(details)) return null;
  const value = details[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringAt(details: JsonValue | undefined, key: string): string | null {
  if (!isObject(details)) return null;
  const value = details[key];
  return typeof value === "string" && value !== "" ? value : null;
}

const CODE_PREFIX = /^\[([^\]]+)\]\s*/;

function splitCode(text: string): { readonly code: string | null; readonly body: string } {
  const found = CODE_PREFIX.exec(text);
  if (found === null) return { code: null, body: text };
  return { code: found[1] ?? null, body: text.slice(found[0].length) };
}

const INTERRUPT_WORDS: ReadonlySet<string> = new Set(["aborted", "Aborted", "cancelled"]);

/** 중단된 줄의 본문. 엔진이 모델에 주는 영어 문장과 한 낱말은 화면 문구로 바꾼다 */
function interruptedBodyOf(body: string): string {
  const text = body.trim();
  if (text === OUTCOME_UNKNOWN_TEXT) return t("desktop.item.interrupted.unknown");
  if (text === NOT_STARTED_TEXT) return t("desktop.item.interrupted.notStarted");
  return INTERRUPT_WORDS.has(text) || text === "" ? t("desktop.item.interrupted.body") : body;
}

/** 엔진이 영어로 주는 흔한 실패를 화면 문구로 바꾼다 (rtE R-10) */
function localizedFailureBody(code: string | null, body: string): string {
  if (code === "plan_mode_inactive" || body.trim() === "Plan mode is not active.") {
    return t("desktop.item.planInactive.body");
  }
  return body;
}

/** 결과 item을 줄 상태로 옮긴다. 결과 item이 아니면 null */
export function toolResultOf(item: ItemRecord): ToolResultView | null {
  if (item.kind !== "toolResult") return null;
  const { details } = item.message;
  const shown = toolOutputOf(item.message.content, details, t("desktop.item.imagePlaceholder"));
  const base = {
    cut: shown.totalLines === null ? null : { shown: shown.shownLines, total: shown.totalLines },
    hook: null,
    blocks: sandboxBlocksOf(details),
    exitCode: numberAt(details, "exitCode"),
    durationMs: numberAt(details, "durationMs"),
    server: stringAt(details, "server"),
  };
  if (!item.message.isError && item.status === "completed") {
    return { ...base, outcome: { kind: "done" }, output: shown.text };
  }
  const { code, body } = splitCode(shown.text);
  if (isUserDenial(details)) {
    return {
      ...base,
      cut: null,
      outcome: { kind: "failed", failure: "denied" },
      output: t("desktop.convo.denied.body"),
    };
  }
  const hook = hookDenialOf(details);
  if (hook !== null) {
    return {
      ...base,
      hook,
      outcome: {
        kind: "failed",
        failure: hook.outcome === "blocked" ? "hookBlocked" : "hookThrew",
      },
      output: hookDenialText(hook),
    };
  }
  if (stringAt(details, "code") === "denied_by_guard") {
    const reason = stringAt(details, "reason");
    return {
      ...base,
      outcome: { kind: "failed", failure: "guard" },
      output:
        reason === null
          ? t("desktop.convo.guard.body")
          : t("desktop.convo.guard.bodyReason", { reason }),
    };
  }
  const agentAborted = stringAt(details, "status") === "aborted";
  if (
    item.status === "interrupted" ||
    code === "fresnel:aborted" ||
    code === "aborted" ||
    agentAborted
  ) {
    return {
      ...base,
      outcome: { kind: "failed", failure: "interrupted" },
      output: interruptedBodyOf(body),
    };
  }
  if (base.blocks.length > 0) {
    return {
      ...base,
      outcome: { kind: "failed", failure: "sandbox" },
      output: localizedFailureBody(code, body),
    };
  }
  return {
    ...base,
    outcome: { kind: "failed", failure: "failed" },
    output: localizedFailureBody(code, body),
  };
}

/** 훅 거부의 본문 한 줄 */
function hookDenialText(hook: HookDenialView): string {
  if (hook.outcome === "blocked") {
    return hook.extension === null
      ? t("desktop.item.hookDenial.blockedNoName", { reason: hook.reason })
      : t("desktop.item.hookDenial.blocked", { extension: hook.extension, reason: hook.reason });
  }
  return hook.extension === null
    ? t("desktop.item.hookDenial.threwNoName")
    : t("desktop.item.hookDenial.threw", { extension: hook.extension });
}

const FAILURE_LABEL: Readonly<Record<FailureKind, MessageId>> = {
  failed: "desktop.item.status.failed",
  denied: "desktop.item.status.denied",
  interrupted: "desktop.item.status.interrupted",
  hookBlocked: "desktop.item.status.hookBlocked",
  hookThrew: "desktop.item.status.hookThrew",
  guard: "desktop.convo.status.guard",
  sandbox: "desktop.tool.blocked.status",
};

export function failureLabelOf(failure: FailureKind): string {
  return t(FAILURE_LABEL[failure]);
}

/** 실패 칩의 빛깔. 사용자의 거부와 중단은 중립, 정책이 멈춘 것은 경고, 사고만 위험이다 */
export function failureToneOf(failure: FailureKind): "danger" | "warning" | "neutral" {
  switch (failure) {
    case "failed":
      return "danger";
    case "denied":
    case "interrupted":
      return "neutral";
    case "guard":
    case "hookBlocked":
    case "hookThrew":
    case "sandbox":
      return "warning";
    default:
      return assertNever(failure, "FailureKind");
  }
}

/** 걸린 시간 글("3.2초", "1분 4초") */
export function durationText(ms: number): string {
  if (ms < 1000) return t("desktop.convo.duration.ms", { ms: Math.round(ms) });
  const seconds = ms / 1000;
  if (seconds < 60)
    return t("desktop.convo.duration.s", {
      seconds: seconds < 10 ? seconds.toFixed(1) : Math.round(seconds),
    });
  const minutes = Math.floor(seconds / 60);
  return t("desktop.convo.duration.m", { minutes, seconds: Math.round(seconds - minutes * 60) });
}

/** bash 끝 메타 "종료 0 · 3.2초". 값이 없으면 null */
export function commandMetaOf(view: ToolResultView): string | null {
  const parts: string[] = [];
  if (view.exitCode !== null) parts.push(t("desktop.convo.exitCode", { code: view.exitCode }));
  if (view.durationMs !== null) parts.push(durationText(view.durationMs));
  return parts.length === 0 ? null : parts.join(" · ");
}

/** 계획 제출 결과(모델용 글 `Plan <id> v<n>: …`)에서 상태와 판을 읽는다 */
export type PlanState = "pending" | "approved" | "rejected" | "revise";

const PLAN_LINE =
  /^Plan (\S+) v(\d+): (awaiting user approval|Approved|Rejected|Revision requested)/;

export function planResultOf(
  text: string,
): { readonly version: number; readonly state: PlanState } | null {
  const found = PLAN_LINE.exec(text.trim());
  if (found === null) return null;
  const word = found[3] ?? "";
  const state: PlanState =
    word === "Approved"
      ? "approved"
      : word === "Rejected"
        ? "rejected"
        : word === "Revision requested"
          ? "revise"
          : "pending";
  return { version: Number(found[2] ?? "1"), state };
}

/** 계획 인자(`title`, `body`). 모양이 틀리면 빈 글 */
export function planArgsOf(args: JsonObject): { readonly title: string; readonly body: string } {
  const title = args["title"];
  const body = args["body"];
  return {
    title: typeof title === "string" ? title : "",
    body: typeof body === "string" ? body : "",
  };
}
