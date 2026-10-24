import type { CapabilityApi, WorkspaceFiles } from "@xeon/contracts/capabilities";

/** `workspace.files`의 서비스 API 타입 */
export type FilesApi = CapabilityApi<typeof WorkspaceFiles>;
