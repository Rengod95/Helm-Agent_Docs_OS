// `./piped` 진입점. Bun이 아닌 Node 런타임(Electron 메인 프로세스)이 자식 프로세스를 띄울 때 쓰는 좁은 면이다.
// 프로세스 기동은 이 L0 패키지에 두고(DR-07), 데스크톱 Electron 셸은 이 진입점만 가져간다(L4.desktop.spec §11).
export {
  spawnPiped,
  type PipedChild,
  type PipedExit,
  type PipedSpawnDeps,
  type PipedSpawnError,
  type PipedSpawnInput,
} from "./port/spawn-piped.ts";
export { detectProcessPlatform, type ProcessPlatformProvider, type TreeSignal } from "./select.ts";
