import type { HostBinaryReport, HostBinaryStatus } from "@xeon/contracts/wire";
import { t } from "../i18n/index.ts";

// 외부 바이너리 점검 결과(G2-07, L0.os.spec §3.6.1 `BinaryCheckReport`에서 경로만 뺀 `HostBinaryReport`)를 화면 값으로 읽는다.
// 값은 `host.status { includeBinaries: true }`의 `binaries`다(F.wire-settings.spec §3.3.1). 연결이 결과를 스키마로 검증하고 건네므로
// 여기서 다시 parse하지 않는다. 결과에 `binaries`가 없으면(구형 호스트, 점검 취소) 화면 값은 없다(null).

type BinaryRow = {
  readonly name: string;
  readonly need: "required" | "optional";
  readonly usedBy: string;
  /** 쓸 수 있으면 true */
  readonly ok: boolean;
  /** 사용자에게 보일 한 줄: 버전 또는 해야 할 일 */
  readonly note: string;
  /** 못 쓸 때 기능에 생기는 영향 */
  readonly impact: string;
};

export type BinaryView = {
  readonly platform: string;
  readonly ready: boolean;
  readonly rows: readonly BinaryRow[];
};

function noteOf(status: HostBinaryStatus): { ok: boolean; note: string } {
  if (status.kind === "ok") return { ok: true, note: status.version };
  if (status.kind === "missing") return { ok: false, note: status.hint };
  if (status.kind === "too_old") {
    return {
      ok: false,
      note: t("client.settings.binary.tooOld", { found: status.found, required: status.required }),
    };
  }
  return { ok: false, note: t("client.settings.binary.unusable", { reason: status.reason }) };
}

/** 점검 보고서를 화면 값으로 바꾼다. 보고서가 없으면 null */
export function binaryViewOf(binaries: HostBinaryReport | undefined): BinaryView | null {
  if (binaries === undefined) return null;
  return {
    platform: binaries.platform,
    ready: binaries.ready,
    // 필수를 앞에 두고, 같은 필수/선택 안에서는 못 쓰는 것을 앞에 둔다
    rows: binaries.items
      .map((item): BinaryRow => {
        const { ok, note } = noteOf(item.status);
        return {
          name: item.name,
          need: item.need,
          usedBy: item.usedBy,
          ok,
          note,
          impact: item.impact,
        };
      })
      .toSorted((a, b) => {
        if (a.need !== b.need) return a.need === "required" ? -1 : 1;
        if (a.ok !== b.ok) return a.ok ? 1 : -1;
        return a.name.localeCompare(b.name);
      }),
  };
}
