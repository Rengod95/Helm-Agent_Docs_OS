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
  /** 대화의 프로젝트 폴더(작업 폴더). 모르면 null이다 */
  projectRoot(threadId: ThreadId | undefined): string | null;
}

/** 프로젝트 폴더 아래 명령 디렉터리 이름 */
export const PROJECT_COMMANDS_DIR: string = ".xeon/commands";
