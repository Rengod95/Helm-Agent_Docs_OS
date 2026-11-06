// 기능 모듈 목록. 다음 트랙은 이 배열에 줄을 더한다(모듈 파일은 src/main/<기능>.ts, `register(ctx)`를 내보낸다).
import type { ShellModule } from "./context.ts";

export const MODULES: readonly ShellModule[] = [];
