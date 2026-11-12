import { t } from "@fresnel/client/i18n";
import type { SettingKey } from "@fresnel/contracts/settings";
import type { ReactNode } from "react";
import { FoldedFields } from "../shared/folded-fields.tsx";
import { FieldRow } from "./settings-field.tsx";
import { fieldOf, type PermissionPanelProps } from "./settings-rules-panel.tsx";

// 도구와 MCP의 "MCP 정책"(DP-111 [결정: 2026-11-11 사용자]). 서버 카드 아래에 접어 둔다. 자주 바꾸지 않는 승인 방식·허용/거부 목록·
// 관리 전용·.mcp.json 가져오기·샌드박스 출처 일곱 줄이다. 바뀐 값이 있으면 펼쳐서 시작한다(공용 접기 구역 `FoldedFields`).

const MCP_POLICY_KEYS: readonly SettingKey[] = [
  "l2.mcp.approvalMode",
  "l2.mcp.allowedServers",
  "l2.mcp.deniedServers",
  "l2.mcp.managedOnly",
  "l2.mcp.importMcpJson",
  "l2.mcp.sandbox.userSource",
  "l2.mcp.sandbox.projectSource",
];

export function McpPolicyPanel(props: PermissionPanelProps): ReactNode {
  const fields = MCP_POLICY_KEYS.flatMap((key) => {
    const field = fieldOf(props.view, key);
    return field === undefined ? [] : [field];
  });
  if (fields.length === 0) return null;
  return (
    <FoldedFields
      title={t("desktop.settings.part.mcpPolicy")}
      count={fields.length}
      forceOpen={fields.some((field) => field.dirty || field.error !== null)}
    >
      {fields.map((field) => (
        <FieldRow
          key={field.key}
          field={field}
          editable={field.editable && (props.live || field.origin === "desktop")}
          saved={props.saved.has(field.key)}
          editors={props.editors}
          handlers={props.handlers}
        />
      ))}
    </FoldedFields>
  );
}
