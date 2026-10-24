// core-models 공개 진입점(L1.models.plan §2). plan은 plugin만 내보내라고 하지만 조립 루트가 설정 경로를 넘기고
// 시험이 서비스를 직접 만들 수 있도록 서비스 팩토리와 M1 설정 선언을 함께 내보낸다.
// 비밀 다리(secretBackedCredentialStore)는 내부 전용이다.
export {
  createModelsExtension,
  extension,
  manifest,
  type ModelsExtensionOptions,
} from "./plugin.ts";
export { createModelService, type ModelServiceDeps, type ModelsSettingsSource } from "./service.ts";
export { ModelRegistrationError } from "./provider-registry.ts";
export type { BeforeProviderRequestInput, ProviderDispatcher } from "./pipeline.ts";
export {
  DEFAULT_MODELS_SETTINGS,
  DEFAULT_RETRY_SETTINGS,
  DEFAULT_THINKING_BUDGETS,
  MODELS_SETTING_DEFS,
  modelsSettingsOf,
  type ModelsSettingReader,
  type ModelsSettings,
  type ProviderSetting,
  type RetrySettings,
} from "./settings.ts";
