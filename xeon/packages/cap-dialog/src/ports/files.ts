import type { FileSystem } from "@xeon/contracts/services";

/**
 * 첨부 원천 파일을 읽는 포트. 실제 구현은 `xeon.exec`의 파일 시스템 부분이다. `xeon.os`에는 파일 읽기 API가 없다
 * (L2.dialog.spec §4.5). 사용자가 직접 붙인 파일이라 작업 폴더 밖 경로도 읽는다.
 */
export type AttachmentFiles = Pick<FileSystem, "fileInfo" | "readBinaryFile">;
