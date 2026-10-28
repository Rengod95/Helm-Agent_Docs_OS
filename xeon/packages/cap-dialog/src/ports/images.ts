import type { CapabilityApi, WorkspaceImages } from "@xeon/contracts/capabilities";

/** `workspace.images`에서 첨부가 쓰는 메서드. 파일은 이 패키지가 읽어 `register`로 넘긴다(작업 폴더 밖 파일도 받기 때문이다) */
export type ImagesPort = Pick<CapabilityApi<typeof WorkspaceImages>, "register">;
