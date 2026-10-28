import type { Api, Model } from "@earendil-works/pi-ai";
import type {
  CacheMarks,
  CachePolicy,
  CacheRetention,
  CacheSite,
  Context,
  ModelRole,
} from "@xeon/contracts/services";

// L1.models.spec §3.6, §4.6, L1.models.plan M-5. 정책은 이 서비스가 만들고 표식 위치는 core-context가 계산하며,
// 요청 적용은 이 서비스가 한다. 적용은 anthropic-messages 페이로드에만 한다. 다른 API는 자동 접두 캐시를 쓰므로
// retention과 sessionKey만 전달한다.

/** 캐시 보존을 두지 않는 역할(L1.models.spec §3.4 표의 기본 캐시 보존) */
const NO_CACHE_ROLES: ReadonlySet<ModelRole> = new Set<ModelRole>(["summary", "judge", "search"]);

/** 표식 위치 우선순위. 앞이 먼저 남는다 */
const DEFAULT_SITES: readonly CacheSite[] = ["system", "tools", "summary", "tail"];

/** anthropic-messages의 cache_control 상한(oc 최대 4개) */
const ANTHROPIC_MAX_BREAKPOINTS = 4;

function compatFlag(model: Model<Api>, name: string): boolean {
  const compat: unknown = Reflect.get(model, "compat");
  if (typeof compat !== "object" || compat === null) return false;
  return Reflect.get(compat, name) === true;
}

/**
 * 역할, 설정된 보존 기간, 모델로 정책을 만든다.
 * - summary·judge·search 역할이나 설정이 none이면 보존 없음, 세션 키 없음, 표식 위치 없음.
 * - 대화 중 system 메시지·도구 변경 지원 여부는 model.compat에서 읽는다(pi-ai가 같은 값을 쓴다).
 */
export function buildCachePolicy(
  role: ModelRole,
  configured: CacheRetention,
  model: Model<Api>,
): CachePolicy {
  const none = NO_CACHE_ROLES.has(role) || configured === "none";
  const system = compatFlag(model, "supportsMidConvoSystemMessages");
  const toolChanges =
    compatFlag(model, "supportsMidConvoToolChanges") ||
    compatFlag(model, "supportsMidConvoToolAdditions");
  return {
    retention: none ? "none" : configured,
    sessionKey: none ? null : "thread",
    sites: none ? [] : DEFAULT_SITES,
    maxBreakpoints: ANTHROPIC_MAX_BREAKPOINTS,
    midConversationSystem: system,
    midConversationToolChanges: system && toolChanges,
  };
}

/**
 * 호출 단위 보존 덮어쓰기(ModelCallOptions.cacheRetention)나 agent-core가 넘긴 값을 정책에 반영한다.
 * 요약·판정·검색 역할은 어떤 덮어쓰기에도 보존 없음이다
 */
export function withRetention(
  policy: CachePolicy,
  role: ModelRole,
  retention: CacheRetention,
): CachePolicy {
  if (NO_CACHE_ROLES.has(role) || retention === "none") {
    return { ...policy, retention: "none", sessionKey: null, sites: [] };
  }
  return {
    ...policy,
    retention,
    sessionKey: "thread",
    sites: policy.sites.length === 0 ? DEFAULT_SITES : policy.sites,
  };
}

// ── 표식 적용 ────────────────────────────────────────────────────────────

type Json = Record<string, unknown>;

function isJson(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const EPHEMERAL = { type: "ephemeral" } as const;

/** 위치 하나의 cache_control을 읽고 쓰는 손잡이 */
interface MarkSlot {
  readonly site: CacheSite;
  has(): boolean;
  clear(): void;
}

/** 블록 하나에 달린 cache_control 슬롯 */
function blockSlot(site: CacheSite, block: Json): MarkSlot {
  return {
    site,
    has: () => block["cache_control"] !== undefined,
    clear: () => {
      Reflect.deleteProperty(block, "cache_control");
    },
  };
}

function lastBlock(content: unknown): Json | undefined {
  if (!Array.isArray(content)) return undefined;
  const last: unknown = content.at(-1);
  return isJson(last) ? last : undefined;
}

/**
 * Context.messages의 인덱스를 anthropic 페이로드 messages의 인덱스로 옮긴다.
 * system 메시지는 페이로드 messages에 들어가지 않고, 연속한 toolResult는 사용자 메시지 하나로 합쳐진다.
 * 짝을 확신할 수 없으면 undefined
 */
function payloadIndexOf(context: Context, messageIndex: number): number | undefined {
  let index = -1;
  let previousWasToolResult = false;
  for (let i = 0; i <= messageIndex; i += 1) {
    const message = context.messages[i];
    if (message === undefined) return undefined;
    if (message.role === "system") continue;
    const isToolResult = message.role === "toolResult";
    if (!(isToolResult && previousWasToolResult)) index += 1;
    previousWasToolResult = isToolResult;
  }
  return index < 0 ? undefined : index;
}

/** 페이로드 messages[i] 마지막 블록에 표식을 단다. 문자열 content는 text 블록으로 바꾼다. 달았으면 참 */
function markMessage(message: Json): boolean {
  const content = message["content"];
  if (typeof content === "string") {
    message["content"] = [{ type: "text", text: content, cache_control: EPHEMERAL }];
    return true;
  }
  const block = lastBlock(content);
  if (block === undefined) return false;
  if (block["cache_control"] === undefined) block["cache_control"] = EPHEMERAL;
  return true;
}

/**
 * 컴팩션 요약 위치(summary)에 표식을 더하고, 표식 수가 정책 상한을 넘으면 sites 뒤쪽부터 버린다.
 * 같은 입력에 같은 결과를 낸다(pi-ai 재시도 때 onPayload가 다시 불려도 안전하다, spec §4.3).
 * 페이로드를 제자리에서 고쳐 돌려준다. 모양을 알아볼 수 없으면 그대로 돌려준다
 */
export function applyCacheMarks(payload: unknown, marks: CacheMarks, context: Context): unknown {
  if (!isJson(payload)) return payload;
  const messages = payload["messages"];
  if (!Array.isArray(messages)) return payload;
  const policy = marks.policy;
  if (policy.retention === "none") return payload;

  const entries: unknown[] = messages;
  const summaryIndex = marks.marks.find((mark) => mark.site === "summary")?.messageIndex;
  const summaryAt =
    typeof summaryIndex === "number" && policy.sites.includes("summary")
      ? payloadIndexOf(context, summaryIndex)
      : undefined;
  const summaryTarget: unknown = summaryAt === undefined ? undefined : entries[summaryAt];
  if (isJson(summaryTarget)) markMessage(summaryTarget);

  // 위치별 슬롯을 우선순위 순으로 모은다: system, tools, summary, tail
  const slots: MarkSlot[] = [];
  const system = payload["system"];
  if (Array.isArray(system)) {
    for (const block of system) if (isJson(block)) slots.push(blockSlot("system", block));
  }
  const tools = payload["tools"];
  if (Array.isArray(tools)) {
    for (const tool of tools) if (isJson(tool)) slots.push(blockSlot("tools", tool));
  }
  entries.forEach((entry, index) => {
    if (!isJson(entry)) return;
    const block = lastBlock(entry["content"]);
    if (block === undefined) return;
    slots.push(blockSlot(index === summaryAt ? "summary" : "tail", block));
  });

  const present = slots.filter((slot) => slot.has());
  const rank = (site: CacheSite): number => {
    const found = policy.sites.indexOf(site);
    return found < 0 ? Number.MAX_SAFE_INTEGER : found;
  };
  // 우선순위가 낮은(뒤쪽) 위치부터 버린다. 같은 위치 안에서는 뒤에 있는 것부터 버린다
  const droppable = present
    .map((slot, order) => ({ slot, order }))
    .toSorted((a, b) => rank(b.slot.site) - rank(a.slot.site) || b.order - a.order);
  let excess = present.length - policy.maxBreakpoints;
  for (const { slot } of droppable) {
    if (excess <= 0) break;
    slot.clear();
    excess -= 1;
  }
  return payload;
}
