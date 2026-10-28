import { assertNever } from "@xeon/contracts";
import type { HostBinaryItem, HostBinaryReport, HostBinaryStatus } from "@xeon/contracts/wire";
import type { BinaryCheckReport } from "@xeon/platform-os";

// host.status의 binaries(G2-07, HS-69). L0.os의 점검 결과(`BinaryCheckReport`)에서 실행 파일의 경로만 빼서 wire 모양으로 옮긴다.
// 경로는 사용자 홈 폴더 같은 값을 담을 수 있고 화면에 필요한 것은 버전과 안내뿐이라 wire에 싣지 않는다.

type CheckItem = BinaryCheckReport["items"][number];

function statusOf(status: CheckItem["status"]): HostBinaryStatus {
  switch (status.kind) {
    case "ok":
      return { kind: "ok", version: status.version, source: status.source };
    case "missing":
      return { kind: "missing", hint: status.hint };
    case "too_old":
      return { kind: "too_old", found: status.found, required: status.required };
    case "unusable":
      return { kind: "unusable", reason: status.reason };
    default:
      return assertNever(status, "BinaryCheckStatus");
  }
}

function itemOf(item: CheckItem): HostBinaryItem {
  return {
    name: item.name,
    need: item.need,
    usedBy: item.usedBy,
    impact: item.impact,
    status: statusOf(item.status),
  };
}

export function hostBinaryReportOf(report: BinaryCheckReport): HostBinaryReport {
  return {
    platform: report.platform,
    ready: report.ready,
    blocking: [...report.blocking],
    degraded: [...report.degraded],
    items: report.items.map(itemOf),
  };
}
