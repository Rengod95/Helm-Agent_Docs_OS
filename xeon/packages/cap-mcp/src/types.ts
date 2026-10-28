import type { McpServerDef } from "@xeon/contracts/capabilities";

// 패키지 내부 공용 타입. SDK 타입을 담지 않는다(adapter.ts 경계).

/** 서버 정의 출처 표기(McpServerStatus.source). 예: "settings:user", "mcpjson:project", "ext:helm" */
type ServerSource = string;

/** 서버가 막히는 이유(McpServerStatus.blockedReason) */
export type BlockedReason =
  | "denied_by_policy"
  | "not_in_allowlist"
  | "managed_only"
  | "untrusted_project";

/** 이름이 정해진 서버 정의 하나 */
export interface ServerDefinition {
  readonly id: string;
  readonly def: McpServerDef;
  readonly source: ServerSource;
  /** 관리 범위에서 정의됐는가(managedOnly 판정) */
  readonly managed: boolean;
  /** 프로젝트 신뢰가 있어야 켜지는 출처(project 범위 설정, .mcp.json) */
  readonly requiresTrust: boolean;
}

/** 정의를 읽는 중 건너뛴 항목. 화면과 진단 명령이 보인다 */
export interface LoaderDiagnostic {
  readonly code:
    | "invalid_definition"
    | "invalid_name"
    | "duplicate_name"
    | "plaintext_secret"
    | "invalid_mcp_json"
    | "untrusted_project"
    | "unreadable";
  readonly source: ServerSource;
  /** 문제가 된 서버 이름(알 수 있을 때) */
  readonly server?: string;
  readonly message: string;
}
