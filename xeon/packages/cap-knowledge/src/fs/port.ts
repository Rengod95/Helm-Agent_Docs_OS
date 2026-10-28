import type { Result } from "@xeon/contracts";

// L2.knowledge.plan §2 fs/port.ts. 운영 구현(node-fs.ts)과 시험 가짜(test/support/memory-fs.ts)를 바꿔 끼우는 파일 포트다.
// 경로는 모두 절대 경로다. 실패는 던지지 않고 FsError 값으로 돌려준다(TY-24).

export type FsErrorKind =
  | "not_found"
  | "not_directory"
  | "is_directory"
  | "exists"
  | "permission_denied"
  | "disk_full"
  | "io";

export interface FsError {
  readonly kind: FsErrorKind;
  readonly path: string;
  /** OS 오류 코드(ENOENT 등). 없으면 빈 문자열 */
  readonly code: string;
  /** 던져진 원본 값 */
  readonly cause?: unknown;
}

export type FsEntryKind = "file" | "directory" | "symlink" | "other";

export interface FsEntry {
  readonly name: string;
  /** 심볼릭 링크를 따라가지 않은 종류 */
  readonly kind: FsEntryKind;
}

export interface FsStat {
  /** 심볼릭 링크를 따라간 종류 */
  readonly kind: "file" | "directory" | "other";
  readonly size: number;
  readonly mtimeMs: number;
}

export interface KnowledgeFs {
  readFile(path: string): Promise<Result<Uint8Array, FsError>>;
  /** 심볼릭 링크를 따라간다 */
  stat(path: string): Promise<Result<FsStat, FsError>>;
  /** 이름 바이트 순으로 정렬해 돌려준다 */
  list(path: string): Promise<Result<readonly FsEntry[], FsError>>;
  realpath(path: string): Promise<Result<string, FsError>>;
  mkdirp(path: string): Promise<Result<void, FsError>>;
  /** 같은 디렉터리의 임시 파일에 쓰고 fsync한 뒤 rename한다. 상위 디렉터리는 만들지 않는다 */
  writeAtomic(path: string, bytes: Uint8Array): Promise<Result<void, FsError>>;
  /** 대상이 이미 있으면 덮어쓰지 않고 exists로 실패한다 */
  rename(from: string, to: string): Promise<Result<void, FsError>>;
  remove(path: string, options: { readonly recursive: boolean }): Promise<Result<void, FsError>>;
  /**
   * 같은 key의 실행을 이 프로세스 안에서 차례로 직렬화한다. 프로세스 사이 배타는 엔진 임대(한 데이터 디렉터리에
   * 엔진 하나)와 락 안 해시 재확인(L2.knowledge.spec §4.4.1 9단계)이 맡는다.
   */
  withLock<T>(key: string, run: () => Promise<T>): Promise<T>;
}
