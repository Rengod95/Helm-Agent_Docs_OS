import type { Logger, Result } from "@fresnel/contracts";
import { sequentially } from "../../util.ts";
import { compareUtf8 } from "./content-hash.ts";
import { appendMigrationLog, readMigrationLines, type MigrationRecord } from "./migrate.ts";
import type { PluginFact } from "../m4/plugin-fact.ts";

// 느슨한 스킬 폴더에서 옮긴 플러그인을 기본 프로필에 넣는다(M5c §7.5 [제안]). 옮김은 프로필을 쓰지 않으므로 옮긴 뒤에는 어느 대화도
// 그 스킬을 받지 못한다. 기본 프로필이 저장되지 않았으면 공장 값이 이미 든다(매니페스트 기본이 켜진 것). 저장되었으면 넣는다.
// 한 번만 한다: `migration.log`에 `loose_skill_profile` 줄을 적고, 그 뒤 사용자가 기본 프로필에서 뺀 것은 다시 넣지 않는다.
// 옮김 기록(`loose_skill` migrated)이 있는 이름만 본다. 로더가 아직 싣지 않았거나 넣기가 실패하면 줄을 적지 않아 다음 시작에 다시 한다.

export interface LooseSkillProfileDeps {
  /** `migration.log`(호스트 상태 폴더) */
  readonly logPath: string;
  readonly logger: Logger;
  readonly now: () => string;
  /** 기본 프로필의 유효 플러그인 이름(저장된 값, 저장하지 않았으면 공장 값) */
  readonly defaultNames: () => Promise<Result<readonly string[], { readonly kind: string }>>;
  /** 로더가 실은 플러그인의 사실. 없으면 undefined(아직 실리지 않았다) */
  readonly factOf: (name: string) => PluginFact | undefined;
  /** 기본 프로필에 넣는다(프로필 쓰기 경로의 `add`). 실패하면 오류 값을 돌려준다 */
  readonly addToDefault: (fact: PluginFact) => Promise<Result<unknown, { readonly kind: string }>>;
}

/**
 * 옮김 기록이 있고 아직 기본 프로필을 처리하지 않은 이름을 넣는다. 처리한 이름을 돌려준다.
 * 기본 프로필에 이미 든 이름은 쓰지 않고 줄만 적는다
 */
export async function addMigratedSkillsToDefault(deps: LooseSkillProfileDeps): Promise<string[]> {
  const lines = await readMigrationLines(deps.logPath, deps.logger);
  if (lines === undefined) return [];
  const handled = new Set(
    lines.filter((line) => line.step === "loose_skill_profile").map((line) => line.name),
  );
  const pending = lines
    .filter((line) => line.step === "loose_skill" && line.outcome === "migrated")
    .filter((line) => !handled.has(line.name))
    .toSorted((a, b) => compareUtf8(a.name, b.name));
  const done: string[] = [];
  // 한 이름씩 차례로 한다. 같은 기본 프로필을 이름마다 다시 읽고 고친다
  await sequentially(pending, async (line) => {
    const names = await deps.defaultNames();
    if (!names.ok) {
      deps.logger.warn("plugin.migration.profile_unreadable", { name: line.name });
      return;
    }
    if (!names.value.includes(line.name)) {
      const fact = deps.factOf(line.name);
      if (fact === undefined) return;
      const added = await deps.addToDefault(fact);
      if (!added.ok) {
        deps.logger.warn("plugin.migration.profile_failed", {
          name: line.name,
          kind: added.error.kind,
        });
        return;
      }
    }
    const record: MigrationRecord = {
      step: "loose_skill_profile",
      name: line.name,
      outcome: "migrated",
      contentHash: line.contentHash,
      reason: null,
    };
    await appendMigrationLog(deps.logPath, [record], deps.now(), deps.logger);
    done.push(line.name);
  });
  return done;
}
