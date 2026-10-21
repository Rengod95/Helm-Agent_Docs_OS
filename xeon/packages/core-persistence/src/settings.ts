import { err, ok, type Result } from "@xeon/contracts";
import { DEFAULT_PERSISTENCE_SETTINGS, type PersistenceSettings } from "./deps.ts";

export interface PersistenceSettingIssue {
  /** l1.persistence. 뒤의 이름 */
  readonly name: string;
  readonly message: string;
}

/**
 * 설정 계층이 합친 값(`l1.persistence.` 뒤 이름을 키로 한 객체)을 PersistenceSettings로 검증한다. 없는 키는 기본값이다.
 * `defineSettings` 선언은 typebox 의존이 이 패키지에 없어 아직 두지 않았다(openIssues).
 * maxResumeAttempts는 M1, autoResume은 M3 키지만 읽는 값은 둘 다 여기에 둔다.
 */
export function resolvePersistenceSettings(
  input: Readonly<Record<string, unknown>>,
): Result<PersistenceSettings, readonly PersistenceSettingIssue[]> {
  const issues: PersistenceSettingIssue[] = [];
  let maxResumeAttempts = DEFAULT_PERSISTENCE_SETTINGS.maxResumeAttempts;
  const attempts = input["maxResumeAttempts"];
  if (attempts !== undefined) {
    if (typeof attempts !== "number" || !Number.isInteger(attempts)) {
      issues.push({ name: "maxResumeAttempts", message: "must be an integer" });
    } else if (attempts < 1 || attempts > 20) {
      issues.push({ name: "maxResumeAttempts", message: "must be between 1 and 20" });
    } else {
      maxResumeAttempts = attempts;
    }
  }
  let autoResume = DEFAULT_PERSISTENCE_SETTINGS.autoResume;
  const auto = input["autoResume"];
  if (auto !== undefined) {
    if (typeof auto === "boolean") autoResume = auto;
    else issues.push({ name: "autoResume", message: "must be a boolean" });
  }
  if (issues.length > 0) return err(issues);
  return ok({ maxResumeAttempts, autoResume });
}
