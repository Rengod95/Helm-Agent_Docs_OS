// @xeon/core-models/testing. 모델 테이프 가짜와 메모리 비밀 서비스(eng.testing.guide TS-04, L1.models.plan §2).
// 운영 코드는 이 서브패스를 import하지 않는다(DR-08).
export {
  contextHash,
  loadTape,
  t,
  tape,
  tapePlayer,
  TapeFormatError,
  TapeLeftoverError,
  TapeMismatchError,
  type ModelTape,
  type ModelTapeHeader,
  type ModelTapeLine,
  type ModelTapeTurn,
  type TapeClock,
  type TapeContent,
  type TapePlayer,
  type TapeRequest,
  type TapeResponse,
  type TapeTarget,
} from "./tape.ts";
export {
  tapeBuildModels,
  tapeProvider,
  type TapeModelDef,
  type TapeProviderCall,
  type TapeProviderHandle,
  type TapeProviderOptions,
} from "./tape-provider.ts";
export { memorySecrets, type MemorySecrets } from "./fake-secrets.ts";
