import type { ExtensionManifest } from "@xeon/contracts/extensions";

export interface GroupCatalogEntry {
  readonly manifest: ExtensionManifest;
  /** 로드 순서 index. 목록 정렬과 상태줄 순서에 쓴다 */
  readonly loadIndex: number;
}

/**
 * 설치된 그룹의 매니페스트와 로드 순서(L3.group-kit.spec §3.8). ExtHost.scopes()는 매니페스트를 주지 않으므로
 * 조립 루트가 로더 보고(`LoadReport`)와 내장 모듈 목록에서 이 포트를 만들어 넘긴다.
 * 그 전까지 시험은 `groupCatalogOf`를 쓴다.
 */
export interface GroupCatalogPort {
  groups(): readonly GroupCatalogEntry[];
}
