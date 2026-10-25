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
  type TapeStream,
  type TapeTarget,
  type TapeWire,
  type TapeWireChunk,
} from "./tape.ts";
export {
  findSecrets,
  MIN_SECRET_LENGTH,
  requestHashOf,
  scrubSecrets,
  summarizeRequest,
  tapeFetch,
  type SecretFinding,
  type TapeFetchHandle,
  type TapeFetchMiss,
  type TapeFetchOptions,
} from "./tape-wire.ts";
export {
  buildRecordedTape,
  recordingFetch,
  renderRecordedTape,
  TapeRecordError,
  type RecordedExchange,
  type RecordedTapeInput,
  type RecordedTurn,
  type RecordFailure,
  type RecordingFetch,
  type RecordingFetchOptions,
} from "./tape-recorder.ts";
export {
  tapeBuildModels,
  tapeProvider,
  type TapeModelDef,
  type TapeProviderCall,
  type TapeProviderHandle,
  type TapeProviderOptions,
} from "./tape-provider.ts";
export { memorySecrets, type MemorySecrets } from "./fake-secrets.ts";
