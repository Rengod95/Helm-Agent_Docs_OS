import { assertNever, type Result } from "@fresnel/contracts";
import type { ExternalToolStatus } from "@fresnel/contracts/extensions";
import type { BinaryCheckReport } from "@fresnel/platform-os";
import { TOOL_PLUGIN_ROWS } from "./tool-plugins.ts";

// 도구 종류 플러그인의 상태(AGE-76 질문 2). 원천은 첫 실행 화면과 `host.status`가 쓰는 L0.os 점검(`checkExternalBinaries`)과 같은 보고서 하나다.
// 플러그인 카드의 `externalTool.status`는 마지막 점검 결과를 복사해 싣고, 점검은 `refresh`가 한다(시작할 때와 `host.status`의 `includeBinaries` 때).
// 점검하는 것은 내장 도구 플러그인(`TOOL_PLUGIN_ROWS`)뿐이다. 사용자 플러그인의 선언은 점검하지 않으므로 프로세스를 띄우지 않는다.

type CheckItem = BinaryCheckReport["items"][number];

/** 점검 항목 하나를 카드의 도구 상태로 옮긴다. 경로는 싣지 않는다 */
function externalToolStatusOf(item: CheckItem): ExternalToolStatus {
  const status = item.status;
  switch (status.kind) {
    case "ok":
      return status.source === "bundled"
        ? { kind: "bundled", version: status.version }
        : { kind: "ready", version: status.version };
    case "missing":
      return { kind: "missing" };
    case "too_old":
      return { kind: "too_old", found: status.found, required: status.required };
    case "unusable":
      return { kind: "unusable", reason: status.reason };
    default:
      return assertNever(status, "BinaryCheckStatus");
  }
}

/** 보고서에서 도구 플러그인 이름별 상태를 만든다. 이 OS의 점검 표에 없는 도구(`not_used`)는 빠진다 */
export function toolStatusesOf(report: BinaryCheckReport): ReadonlyMap<string, ExternalToolStatus> {
  const byBinary = new Map<string, CheckItem>(report.items.map((item) => [item.name, item]));
  const statuses = new Map<string, ExternalToolStatus>();
  for (const row of TOOL_PLUGIN_ROWS) {
    const item = byBinary.get(row.tool.binary);
    if (item !== undefined) statuses.set(row.name, externalToolStatusOf(item));
  }
  return statuses;
}

export interface ToolStatusSource {
  /** 마지막 점검에서 낸 상태. 점검 전이거나 점검하지 않는 이름이면 undefined */
  statusOf(name: string): ExternalToolStatus | undefined;
  /** 점검 결과를 받아 복사를 바꾼다(취소된 점검은 복사를 그대로 둔다) */
  accept(result: Result<BinaryCheckReport, { readonly kind: "cancelled" }>): void;
}

export function createToolStatusSource(): ToolStatusSource {
  let statuses: ReadonlyMap<string, ExternalToolStatus> = new Map();
  return {
    statusOf: (name) => statuses.get(name),
    accept(result) {
      if (result.ok) statuses = toolStatusesOf(result.value);
    },
  };
}
