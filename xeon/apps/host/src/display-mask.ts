import type {
  ApprovalMaskEntry,
  ItemMaskEntry,
  ItemRecord,
  LeafMask,
  PartMask,
} from "@fresnel/contracts/conversation";
import type { ApprovalRequestedPayload } from "@fresnel/contracts/records";
import type { PendingApproval } from "@fresnel/contracts/wire";
import type { SecretsPort } from "./types.ts";

// L0.secrets.spec §3.5.1, F.wire-settings.spec §3.4.5a [결정: 2026-11-03 사용자].
// 화면 가림 표식을 wire에 싣기 위한 계산이다. 값은 이 모듈을 나가지 않는다. 구간, 길이, 표지 이름만 만든다.
// 이벤트 payload와 저장 행은 건드리지 않는다. 클라이언트가 같은 문자열에 구간을 적용한다(`@fresnel/contracts/conversation`의 display-mask-apply).

export type DisplayMaskPort = SecretsPort["display"];

/** 내구 item 하나의 잎 표식. 가릴 잎이 없으면 undefined다(wire에 필드를 싣지 않는다). 포인터는 item 레코드 기준이다 */
export function itemLeafMasks(
  display: DisplayMaskPort,
  item: ItemRecord,
): readonly LeafMask[] | undefined {
  // 메시지 아래의 문자열 잎만 본다. id와 상태 같은 자리는 클라이언트가 키로 쓰므로 가리지 않는다
  const leaves = display.displayLeafMasks(item.message, "/message");
  return leaves.length === 0 ? undefined : leaves;
}

/** thread.read 결과의 item별 표식. 가릴 것이 없는 item은 뺀다 */
export function itemMaskEntries(
  display: DisplayMaskPort,
  items: readonly ItemRecord[],
): ItemMaskEntry[] {
  const out: ItemMaskEntry[] = [];
  for (const item of items) {
    const leaves = itemLeafMasks(display, item);
    if (leaves !== undefined) out.push({ itemId: item.itemId, leaves: [...leaves] });
  }
  return out;
}

/**
 * 승인 요청의 잎 표식. 제목, 출처(caller 등), 본문의 문자열 전부(도구 인자, 계획, 질문, 검토)를 본다.
 * 포인터는 approval.requested payload 기준이다. 클라이언트 적용기(`maskApprovalRequest`)는 본문의 문자열 필드마다
 * 같은 자리의 표식을 적용하므로, 여기서 본 잎이 화면의 글을 빠짐없이 덮는다. 요청 키와 식별자는 화면 글이 아니라 빼지 않는다.
 */
export function approvalLeafMasks(
  display: DisplayMaskPort,
  request: ApprovalRequestedPayload,
): readonly LeafMask[] | undefined {
  const leaves = [
    ...display.displayLeafMasks(request.title, "/title"),
    ...display.displayLeafMasks(request.origin, "/origin"),
    ...display.displayLeafMasks(request.body, "/body"),
  ];
  return leaves.length === 0 ? undefined : leaves;
}

/** approval.list 결과의 승인별 표식. 가릴 것이 없는 승인은 뺀다 */
export function approvalMaskEntries(
  display: DisplayMaskPort,
  approvals: readonly PendingApproval[],
): ApprovalMaskEntry[] {
  const out: ApprovalMaskEntry[] = [];
  for (const approval of approvals) {
    const leaves = approvalLeafMasks(display, approval.request);
    if (leaves !== undefined) out.push({ approvalId: approval.approvalId, leaves: [...leaves] });
  }
  return out;
}

/** 추적하는 진행 중 파트의 상한. 넘으면 새 파트는 확인되지 않은 것으로 둔다(클라이언트는 확정 item이 올 때까지 가린다) */
const MAX_TRACKED_PARTS = 4096;

export interface PartMasker {
  /** 파트 조각 하나의 표식. `start`는 빈 누적에서 시작하고 `delta`만 누적을 늘린다(클라이언트의 이어 붙이기와 같다) */
  delta(partId: string, phase: "start" | "delta" | "end", text: string): PartMask;
  /** 파트가 끝났다. 누적을 버린다 */
  completed(partId: string): void;
  /** 확정 item이 기록됐다. 그 item의 파트 누적을 버린다 */
  recorded(partIds: readonly string[]): void;
}

/**
 * 진행 중 파트마다 누적 원문을 든다. 누적은 호스트가 받은 조각 전부다. 클라이언트가 조각을 놓쳤으면 길이가 달라서 가린다.
 * 보이는 앞부분은 낱말이 끝난 곳까지다(`displayVisibleLength`). 구간은 그 앞부분에서만 구한다.
 * `end` 조각에서는 누적이 끝났으므로 꼬리를 빼지 않는다.
 */
export function createPartMasker(display: DisplayMaskPort): PartMasker {
  // 누적 원문은 이 프로세스 메모리에만 있다. null은 누적을 믿을 수 없는 파트다
  const streams = new Map<string, string | null>();
  return {
    delta(partId, phase, text) {
      let next: string | null;
      if (phase === "start") {
        next = streams.size < MAX_TRACKED_PARTS || streams.has(partId) ? "" : null;
      } else {
        const known = streams.get(partId);
        next =
          known === undefined || known === null ? null : known + (phase === "delta" ? text : "");
      }
      streams.set(partId, next);
      if (next === null) return { verified: false };
      const visible = phase === "end" ? next.length : display.displayVisibleLength(next);
      return {
        verified: true,
        len: next.length,
        visible,
        ranges: [...display.displayRanges(next.slice(0, visible))],
      };
    },
    completed(partId) {
      streams.delete(partId);
    },
    recorded(partIds) {
      for (const partId of partIds) streams.delete(partId);
    },
  };
}
