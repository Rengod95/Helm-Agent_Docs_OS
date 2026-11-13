import type { Result } from "../base/index.ts";

// L1.tools.spec §4.8 잘린 도구 출력의 파일 사본. 원문은 blob 저장소가 정본이고, 모델은 이 파일을 평소 쓰는 `read`·`grep`·`bash`로 읽는다.
// 구현은 platform-exec(`createToolOutputFiles`), 쓰는 쪽은 core-tools, 읽기 루트를 여는 쪽은 cap-workspace다.

export type ToolOutputFilesError =
  | { readonly kind: "io"; readonly cause: unknown }
  | { readonly kind: "blob_missing"; readonly sha256: string };

export interface ToolOutputFiles {
  /** 모든 대화의 출력 파일을 두는 폴더(엔진 전용, 읽기 루트에만 더한다) */
  readonly dir: string;
  /** 이 대화의 이 blob 사본 경로. 파일이 있는지는 보지 않는다 */
  pathFor(threadId: string, sha256: string): string;
  /** 사본을 쓴다. 이미 있으면 그대로 둔다 */
  write(
    threadId: string,
    sha256: string,
    bytes: Uint8Array,
  ): Promise<Result<string, ToolOutputFilesError>>;
  /**
   * 없는 사본을 blob에서 다시 만든다. `path`가 `pathFor`가 만드는 꼴이 아니면 `false`, 만들었거나 이미 있으면 `true`.
   * 재시작·보관 정리 뒤에도 안내의 경로가 죽지 않게 읽기 직전에 부른다
   */
  restore(path: string): Promise<Result<boolean, ToolOutputFilesError>>;
  /** 대화의 사본 폴더를 지운다 */
  removeThread(threadId: string): Promise<void>;
  /** 살아 있지 않은 대화의 폴더를 지운다. 지운 폴더 수 */
  sweep(isLive: (threadId: string) => boolean): Promise<number>;
}
