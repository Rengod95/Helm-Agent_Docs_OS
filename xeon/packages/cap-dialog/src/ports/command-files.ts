import type { ThreadId } from "@xeon/contracts/conversation";
import type { FileSystem } from "@xeon/contracts/services";

/**
 * 명령 파일을 읽는 포트. 실제 구현은 `xeon.exec`의 파일 시스템 부분이다(L2.dialog.plan §4.2 포크 표 첫 행).
 * pi 원본은 `fs`를 직접 불렀다.
 */
export type CommandFiles = Pick<FileSystem, "listDir" | "readTextFile">;

/**
 * 명령 파일을 찾을 디렉터리의 뿌리. 기본 디렉터리 이름 `.xeon/commands`는 [가정]이고 L4.host-service.spec이 정한다
 * (L2.dialog.spec §10 D-8). 사용자 디렉터리와 프로젝트 디렉터리를 합쳐 쓴다.
 */
export interface CommandRoots {
  /** 사용자 명령 디렉터리. 예: `~/.xeon/commands` */
  readonly userDir: string;
  /** 사용자 홈. 설정 디렉터리의 `~/`를 푼다 */
  readonly home: string;
  /**
   * 대화의 프로젝트 폴더(작업 폴더). 작업 폴더가 없거나 대화를 모르면 null이다. 엔진 cwd로 대신하지 않는다(`L2.readme` §5.10)
   */
  projectRoot(threadId: ThreadId | undefined): string | null;
  /**
   * 프로젝트 폴더가 신뢰되었는가(`X.loading-trust.spec` §4.7의 `trusted`). 신뢰하지 않은 폴더의 `.xeon/commands`와 그 폴더 기준
   * 상대 경로 명령 디렉터리는 읽지 않는다: 저장소가 낸 명령 파일은 모델에게 가는 프롬프트 본문이고 셸 주입(`!{…}`)을 담을 수
   * 있기 때문이다. 판정이 실패하면 거짓이다(fail-closed)
   */
  projectTrusted(projectDir: string): Promise<boolean>;
}

/** 프로젝트 폴더 아래 명령 디렉터리 이름 */
export const PROJECT_COMMANDS_DIR: string = ".xeon/commands";
