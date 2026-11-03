import { createHash } from "node:crypto";
import { attempt, err, ok, parse, type Result } from "@fresnel/contracts";
import { JsonValueSchema, type JsonValue, type ThreadId } from "@fresnel/contracts/conversation";
import {
  ApprovalServicePortKey,
  type ApprovalRequestError,
  type QuestionBody,
} from "@fresnel/contracts/services";
import { requestKeyFor } from "@fresnel/contracts/records";
import {
  InputQueuePortKey,
  RecordKindSchema,
  type EnqueueError,
  type ExtensionName,
  type RegistrationId,
} from "@fresnel/contracts/extensions";
import type { HostCore, RegistrationRecord } from "./core.ts";

// 화면(Plugin UI)이 대화에 말을 걸고 승인을 청하는 길(ADR-0021 §3.4 `post`·`requestApproval`, F.wire-settings §4.2 `ext.ui.post`·`ext.ui.requestApproval`).
// 호출한 화면의 대화(`threadId`)는 호출자가 정한다. 호스트는 대화, 확장, 화면 선언, 켜짐을 검사한 뒤 입력 큐나 승인 서비스로 넘긴다.

export type ExtUiRefusal =
  /** 이 엔진에 열려 있는 대화가 아니다 */
  | { readonly kind: "unknown_thread"; readonly threadId: string }
  | { readonly kind: "unknown_extension"; readonly extension: string }
  /** 확장은 있으나 그 대화에서 호출을 받을 Registration이 꺼져 있다 */
  | { readonly kind: "extension_off"; readonly extension: string }
  /** 매니페스트 `ui`에 없는 화면 id */
  | { readonly kind: "ui_not_declared"; readonly ui: string }
  /** 매니페스트 `methods`에 없는 동사 */
  | { readonly kind: "method_not_declared"; readonly method: string }
  /** 확장의 어느 플러그인도 `usesPost: true`를 선언하지 않았다 */
  | { readonly kind: "post_not_allowed"; readonly extension: string }
  /** `name`으로 확장 kind(`x.<확장>.ui.<name>`)를 만들 수 없다 */
  | { readonly kind: "name_invalid"; readonly name: string }
  /** `payload`가 JSON 값이 아니다 */
  | { readonly kind: "payload_invalid" }
  | { readonly kind: "port_unavailable"; readonly port: "input_queue" | "approvals" }
  | { readonly kind: "thread_closed"; readonly threadId: string }
  /** 같은 키가 다른 내용으로 다시 왔다 */
  | { readonly kind: "key_reused"; readonly requestId: string }
  /** 저장소 실패나 커밋 거부. `reason`은 원인의 종류다 */
  | { readonly kind: "storage"; readonly reason: string };

export interface ExtUiPostInput {
  readonly extension: ExtensionName;
  readonly ui: string;
  readonly threadId: ThreadId;
  readonly name: string;
  readonly payload?: unknown;
  /** 멱등 키(1~64자). 생략하면 새 키 */
  readonly requestId?: string;
}

export interface ExtUiApprovalInput {
  readonly extension: ExtensionName;
  readonly ui: string;
  readonly threadId: ThreadId;
  readonly method: string;
  readonly params?: unknown;
  readonly requestId?: string;
}

export interface ExtUi {
  /** 입력 큐에 확장 메시지 하나를 넣는다. 단계 경계에서 모델 문맥에 들어간다. 같은 `requestId`는 한 번만 들어간다 */
  post(input: ExtUiPostInput): Promise<Result<{ readonly duplicate: boolean }, ExtUiRefusal>>;
  /** 승인 카드를 만들고 기다리지 않는다. 같은 `requestId`는 같은 승인을 돌려준다 */
  requestApproval(
    input: ExtUiApprovalInput,
  ): Promise<Result<{ readonly approvalId: string }, ExtUiRefusal>>;
}

const TITLE_MAX = 120;
const TEXT_MAX = 2000;
const PREVIEW_MAX = 400;
/** 입력 큐 멱등 키 상한(`PostOptions.requestId`) */
const POST_KEY_MAX = 64;

function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** 값을 짧은 JSON 글로 줄인다. 직렬화할 수 없으면 빈 글이다 */
function previewOf(value: unknown): string {
  if (value === undefined) return "";
  const text = attempt(() => JSON.stringify(value));
  return text.ok ? clip(text.value, PREVIEW_MAX) : "";
}

function storageReason(error: EnqueueError | ApprovalRequestError): string {
  return error.kind;
}

export function createExtUi(core: HostCore): ExtUi {
  /** 대화에서 호출을 받을 수 있는 Registration. 열린 세대가 있고 그 대화에서 켜져 있어야 한다 */
  function liveScopes(
    unit: { readonly scopeIds: readonly RegistrationId[] },
    threadId: ThreadId,
  ): RegistrationRecord[] {
    return unit.scopeIds.flatMap((id) => {
      const record = core.scopes.get(id);
      const open = record?.generation?.open === true && core.activeIn(threadId, id);
      return record !== undefined && open ? [record] : [];
    });
  }

  /** 공통 검사: 대화, 확장, 화면 선언. 통과하면 확장 단위를 돌려준다 */
  function admit(
    extension: ExtensionName,
    ui: string,
    threadId: ThreadId,
  ): Result<NonNullable<ReturnType<typeof core.units.get>>, ExtUiRefusal> {
    if (!core.threads.has(threadId)) return err({ kind: "unknown_thread", threadId });
    const unit = core.units.get(extension);
    if (unit === undefined) return err({ kind: "unknown_extension", extension });
    if (!(unit.manifest.ui?.items ?? []).some((item) => item.id === ui)) {
      return err({ kind: "ui_not_declared", ui });
    }
    return ok(unit);
  }

  return {
    async post(input) {
      const admitted = admit(input.extension, input.ui, input.threadId);
      if (!admitted.ok) return admitted;
      const unit = admitted.value;
      const posting = unit.scopeIds.flatMap((id) => {
        const record = core.scopes.get(id);
        return record?.plugin.decl.usesPost === true ? [id] : [];
      });
      if (posting.length === 0) {
        return err({ kind: "post_not_allowed", extension: input.extension });
      }
      const target = liveScopes(unit, input.threadId).find((record) => posting.includes(record.id));
      if (target === undefined) return err({ kind: "extension_off", extension: input.extension });
      const customType = parse(RecordKindSchema, `x.${input.extension}.ui.${input.name}`);
      if (!customType.ok) return err({ kind: "name_invalid", name: input.name });
      const details = detailsOf(input.payload);
      if (!details.ok) return err({ kind: "payload_invalid" });
      const port = core.ports.get(InputQueuePortKey);
      if (port === undefined) return err({ kind: "port_unavailable", port: "input_queue" });
      const requestId = input.requestId ?? `ui:${crypto.randomUUID()}`;
      if (requestId.length < 1 || requestId.length > POST_KEY_MAX) {
        return err({ kind: "key_reused", requestId });
      }
      const text = previewOf(input.payload);
      const queued = await port.enqueue({
        threadId: input.threadId,
        scopeId: target.id,
        requestId,
        when: "steer",
        item: {
          kind: "context",
          customType: customType.value,
          content: text === "" ? input.name : `${input.name}: ${text}`,
          display: true,
          ...(details.value === undefined ? {} : { details: details.value }),
        },
      });
      if (!queued.ok) {
        const error = queued.error;
        if (error.kind === "thread_closed") {
          return err({ kind: "thread_closed", threadId: input.threadId });
        }
        return err({ kind: "storage", reason: storageReason(error) });
      }
      return ok({ duplicate: queued.value.duplicate });
    },

    async requestApproval(input) {
      const admitted = admit(input.extension, input.ui, input.threadId);
      if (!admitted.ok) return admitted;
      const unit = admitted.value;
      if (!(unit.manifest.methods ?? []).some((decl) => decl.verb === input.method)) {
        return err({ kind: "method_not_declared", method: input.method });
      }
      const live = liveScopes(unit, input.threadId)[0];
      if (live === undefined) return err({ kind: "extension_off", extension: input.extension });
      const approvals = core.ports.get(ApprovalServicePortKey);
      if (approvals === undefined) return err({ kind: "port_unavailable", port: "approvals" });
      const requestId = input.requestId ?? `ui:${crypto.randomUUID()}`;
      const shown = unit.manifest.displayName;
      const label = shown === undefined || shown === "" ? input.extension : shown;
      const preview = previewOf(input.params);
      const opened = await approvals.open({
        origin: {
          threadId: input.threadId,
          turnId: null,
          stepId: null,
          toolCallId: null,
          caller: `ext:${input.extension}`,
        },
        // 같은 확장의 같은 requestId는 같은 승인이다. drive의 `loop.ask`와 같은 키 모양이고 접두만 다르다
        requestKey: requestKeyFor(`ui:${input.extension}:${requestId}`, sha256Hex),
        title: clip(`${label} asks to run ${input.method}`, TITLE_MAX),
        body: { kind: "question", question: approvalQuestion(label, input.method, preview) },
        remember: ["once"],
      });
      if (!opened.ok) {
        if (opened.error.kind === "key_reused") return err({ kind: "key_reused", requestId });
        return err({ kind: "storage", reason: storageReason(opened.error) });
      }
      return ok({ approvalId: opened.value.request.approvalId });
    },
  };
}

function approvalQuestion(label: string, method: string, preview: string): QuestionBody {
  const base = `${label} wants to run "${method}".`;
  return {
    questions: [
      {
        id: "decision",
        text: clip(preview === "" ? base : `${base} Parameters: ${preview}`, TEXT_MAX),
        options: [
          { id: "allow", label: "Allow" },
          { id: "deny", label: "Deny" },
        ],
        multiSelect: false,
        allowFreeText: false,
      },
    ],
  };
}

/** 페이로드는 JSON 값이어야 기록에 남을 수 있다. 없으면 undefined다 */
function detailsOf(payload: unknown): Result<JsonValue | undefined, "not_json"> {
  if (payload === undefined) return ok(undefined);
  const parsed = parse(JsonValueSchema, payload);
  return parsed.ok ? ok(parsed.value) : err("not_json");
}
