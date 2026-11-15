import type { Result } from "@fresnel/contracts";

export interface BinaryFs {
  readFile(path: string): Promise<Result<Uint8Array, { readonly code: string }>>;
  /** 실행 가능한 일반 파일이면 true */
  isExecutableFile(path: string): Promise<boolean>;
  /** 폴더 안의 이름들. 읽을 수 없으면 빈 목록. 없으면 버전 폴더를 가진 설치 자리(mise, asdf)는 건너뛴다 */
  listDir?(path: string): Promise<readonly string[]>;
}
