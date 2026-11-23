import { attemptAsync, parse, parseJson, type LogFields } from "@fresnel/contracts";
import {
  isCapabilityError,
  KnowledgeLedger,
  KnowledgeLedgerKey,
  type CallOptions,
} from "@fresnel/contracts/capabilities";
import {
  defineManifest,
  type ExtensionEntry,
  type RegistrationStatus,
} from "@fresnel/contracts/extensions";
import type {
  ProposalDecideResult,
  ProposalListParams,
  ProposalListResult,
  ProposalRow,
  ProposalSource,
} from "@fresnel/contracts/wire";
import { createKnowledgeProposalWire, type KnowledgeProposalWire } from "@fresnel/cap-knowledge";
import type { ExtensionUnit } from "@fresnel/ext-host";
import { Type } from "typebox";
import type { ProposalPort } from "../types.ts";
import { SUGGEST_PLUGIN_NAME } from "./default-plugins.ts";

// M3-REQ-18. 승인 화면이 읽는 제안 대기열은 L2.knowledge 하나다. 학습 그룹은 빌트인에서 빠졌다(2026-11-18 사용자, AGE-49): 학습 출처(`source: "learning"`)의 목록은
// 늘 `unavailable`이고 결정은 거절한다. 이 파일은 조립 루트 코드다(DR-14 예외 2).

const DEFAULT_LIMIT = 50;
/** 쪽 크기 상한. 요청한 `limit`이 더 커도 이 크기로 줄여 돌려주고 `nextCursor`가 이어 간다 */
const PAGE_MAX = 100;
/** 같은 `createdAt`의 행이 쪽 경계에 걸릴 때를 위한 여유 행 수(지식 어댑터의 같은 시각 정렬은 id 내림차순이라 합친 목록과 반대다) */
const TIE_PAD = 50;

export interface ProposalPortDeps {
  /** 지식 기능이 있으면 대기열 어댑터, 없으면 undefined */
  readonly knowledge: () => KnowledgeProposalWire | undefined;
  /**
   * 제안 플러그인(`suggest`)이 켜져 있는가. 꺼졌거나, 프로필에서 빠졌거나, 설치되지 않았으면 거짓이다. 거짓이면 목록의 지식 출처는
   * `unavailable`이고 결정은 `unavailable`이다. 다시 켜면 다음 호출부터 열린다(읽을 때마다 본다)
   */
  readonly suggestEnabled: () => boolean;
  /** 오류 기록(결정에 쓰지 않는 실패: 알 수 없는 오류 코드) */
  readonly report: (message: string, fields: LogFields) => void;
}

interface RowKey {
  readonly createdAt: number;
  readonly source: ProposalSource;
  readonly id: string;
}

/** 합친 목록의 순서: `createdAt` 내림차순, 같으면 `(source, id)` 오름차순 */
function compareKeys(a: RowKey, b: RowKey): number {
  if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
  if (a.source !== b.source) return a.source < b.source ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

const CursorSchema = Type.Object(
  {
    createdAt: Type.Integer({ minimum: 0 }),
    source: Type.Union([Type.Literal("learning"), Type.Literal("knowledge")]),
    id: Type.String(),
  },
  { additionalProperties: false },
);

function encodeCursor(row: RowKey): string {
  const cursor: RowKey = { createdAt: row.createdAt, source: row.source, id: row.id };
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

/** 불투명 커서. 읽을 수 없으면 undefined이고 호출한 쪽은 처음부터 읽는다 */
function decodeCursor(text: string | undefined): RowKey | undefined {
  if (text === undefined) return undefined;
  const json = parseJson(Buffer.from(text, "base64url").toString("utf8"));
  if (!json.ok) return undefined;
  const parsed = parse(CursorSchema, json.value);
  return parsed.ok ? parsed.value : undefined;
}

function afterCursor(row: RowKey, cursor: RowKey | undefined): boolean {
  return cursor === undefined || compareKeys(row, cursor) > 0;
}

/**
 * 제안 플러그인이 켜져 있는가. 루트 등록(이름 `suggest`)의 상태가 `enabled`이면 참이다. 등록이 없으면(설치되지 않았거나 프로필에서 빠짐)
 * 거짓이다. 확장 목록(`ext.list`)과 같은 원천인 `ext.registrations()`를 읽는다
 */
export function suggestEnabledOf(
  registrations: readonly { readonly id: string; readonly status: RegistrationStatus }[],
): boolean {
  return registrations.some((info) => info.id === SUGGEST_PLUGIN_NAME && info.status === "enabled");
}

/** 호스트(사용자)가 부른 호출 문맥. 결정과 목록은 사람의 일이다(`ledger.decide`는 호스트 호출만 받는다) */
function hostCall(signal: AbortSignal): CallOptions {
  return { signal, context: { caller: { kind: "host" } } };
}

function decideFailure(
  reason: Extract<ProposalDecideResult, { ok: false }>["reason"],
  detail?: string,
): ProposalDecideResult {
  return { ok: false, reason, ...(detail === undefined ? {} : { detail }) };
}

export function createProposalPort(deps: ProposalPortDeps): ProposalPort {
  /** 지식 출처의 행. 어댑터가 없거나 읽기가 실패하면 undefined */
  async function knowledgeRows(
    params: ProposalListParams,
    limit: number,
    cursor: RowKey | undefined,
    signal: AbortSignal,
  ): Promise<readonly ProposalRow[] | undefined> {
    if (!deps.suggestEnabled()) return undefined;
    const wire = deps.knowledge();
    if (wire === undefined) return undefined;
    const read = await attemptAsync(() =>
      wire.list(
        {
          ...(params.status === undefined ? {} : { status: params.status }),
          limit: Math.min(limit, 200),
          // 커서가 있으면 그 시각 이전(같은 시각 포함)부터 읽는다. 같은 시각의 앞선 행은 호출한 쪽이 `afterCursor`로 거른다
          ...(cursor === undefined ? {} : { before: { createdAt: cursor.createdAt + 1, id: "" } }),
        },
        hostCall(signal),
      ),
    );
    if (read.ok) return read.value;
    if (isCapabilityError(read.error.cause)) {
      deps.report("proposal.knowledge_list_failed", { code: read.error.cause.data.code });
      return undefined;
    }
    throw read.error.cause;
  }

  return {
    async list(params, signal) {
      const wanted: readonly ProposalSource[] =
        params.source === undefined ? ["knowledge"] : [params.source];
      // 지식 어댑터는 한 번에 200행까지 준다. 한 쪽(page)이 그 안에서 `limit + 1`행과 같은 시각의 중복 여유(TIE_PAD)를 채우도록 쪽 크기를 제한한다
      const limit = Math.min(params.limit ?? DEFAULT_LIMIT, PAGE_MAX);
      const cursor = decodeCursor(params.cursor);
      const unavailable: ProposalSource[] = [];
      const rows: ProposalRow[] = [];
      // 학습은 빌트인이 아니다: 출처를 직접 고른 요청만 `unavailable`로 알린다
      if (wanted.includes("learning")) unavailable.push("learning");
      if (wanted.includes("knowledge")) {
        const knowledge = await knowledgeRows(params, limit + 1 + TIE_PAD, cursor, signal);
        if (knowledge === undefined) unavailable.push("knowledge");
        else rows.push(...knowledge);
      }
      const ordered = rows.toSorted(compareKeys).filter((row) => afterCursor(row, cursor));
      const page = ordered.slice(0, limit);
      const last = page.at(-1);
      const result: ProposalListResult = {
        proposals: page,
        nextCursor: ordered.length > limit && last !== undefined ? encodeCursor(last) : null,
        unavailable,
      };
      return result;
    },
    async decide(params, signal) {
      if (params.source === "learning") {
        return decideFailure("unavailable", "the learning plugin is not built in");
      }
      if (!deps.suggestEnabled()) {
        return decideFailure("unavailable", "the suggest plugin is off");
      }
      const wire = deps.knowledge();
      if (wire === undefined)
        return decideFailure("unavailable", "knowledge store is not available");
      return wire.decide(params, hostCall(signal));
    },
  };
}

/** `fresnel.knowledge`의 제안 대기열 어댑터를 나중에 채우는 자리. 브리지 확장이 채우고 `proposal.*` 처리기가 부를 때 읽는다 */
export interface KnowledgeWireHolder {
  current: KnowledgeProposalWire | undefined;
}

const BRIDGE_NAME = "host-proposals-bridge";

/**
 * `knowledge.ledger` 기능으로 L2.knowledge 제안 대기열 어댑터를 만들어 `holder`에 채우는 조립 확장. `proposal.list`·`proposal.decide`가
 * 호스트(사용자) 호출 문맥으로 부른다. 안전 모드에서도 L2는 싣기 때문에 이 확장도 싣는다
 */
export function proposalsBridgePlugin(
  holder: KnowledgeWireHolder,
  loadIndex: number,
): ExtensionUnit {
  const manifest = defineManifest({
    schemaVersion: 2,
    name: BRIDGE_NAME,
    version: "0.1.0",
    displayName: "Proposal Service Bridge",
    purpose: "Brings knowledge proposals to you for a decision.",
    description:
      "Sends knowledge proposals waiting for a decision to the app and returns your answer; without it, proposals cannot be accepted or rejected.",
    defaultEnabled: true,
    entry: "./src/index.ts",
    plugins: [
      {
        layer: "L2",
        hooks: [],
        requires: [{ id: KnowledgeLedger.id, range: `^${KnowledgeLedger.version}` }],
      },
    ],
    trust: { level: "builtin" },
  });
  const entry: ExtensionEntry = ({ manifest: loaded, register }) => {
    register(loaded.name, { defaultEnabled: true }, (g) => {
      holder.current = createKnowledgeProposalWire(g.capability(KnowledgeLedgerKey));
      g.onDispose(() => {
        holder.current = undefined;
      });
    });
  };
  return { manifest, entry, loadIndex, builtin: true };
}
