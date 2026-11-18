import type { Logger, Result } from "@fresnel/contracts";
import { sequentially } from "../../util.ts";
import { compareUtf8 } from "./content-hash.ts";
import { appendMigrationLog, readMigrationLines, type MigrationRecord } from "./migrate.ts";
import type { PluginFact } from "../m4/plugin-fact.ts";

// 느슨한 스킬 폴더에서 옮긴 플러그인을 공통 묶음(`common`, 모든 프로필에 드는 묶음)에 넣는다(M5c §7.5, 사용자 결정 2026-11-18 AGE-41).
// 옮김은 프로필을 쓰지 않으므로 옮긴 뒤에는 어느 대화도 그 스킬을 받지 못한다. 공통 묶음에 넣으면 저장된 기본 프로필은 그대로 두고 모든 프로필의 대화가 받는다.
// 한 번만 한다: `migration.log`에 `loose_skill_profile` 줄을 적고, 그 뒤 사용자가 공통 묶음에서 뺀 것은 다시 넣지 않는다.
// 옮김 기록(`loose_skill` migrated)이 있는 이름만 본다. 로더가 아직 싣지 않았거나 넣기가 실패하면 줄을 적지 않아 다음 시작에 다시 한다.

export interface LooseSkillProfileDeps {
  /** `migration.log`(호스트 상태 폴더) */
  readonly logPath: string;
  readonly logger: Logger;
  readonly now: () => string;
  /** 공통 묶음의 플러그인 이름(읽은 값) */
  readonly commonNames: () => Promise<Result<readonly string[], { readonly kind: string }>>;
  /** 로더가 실은 플러그인의 사실. 없으면 undefined(아직 실리지 않았다) */
  readonly factOf: (name: string) => PluginFact | undefined;
  /** 공통 묶음에 넣는다(공통 묶음 쓰기 경로의 `add`, `COMMON_ID`). 실패하면 오류 값을 돌려준다 */
  readonly addToCommon: (fact: PluginFact) => Promise<Result<unknown, { readonly kind: string }>>;
}

/**
 * 옮김 기록이 있고 아직 공통 묶음을 처리하지 않은 이름을 넣는다. 처리한 이름을 돌려준다.
 * 공통 묶음에 이미 든 이름은 쓰지 않고 줄만 적는다
 */
export async function addMigratedSkillsToCommon(deps: LooseSkillProfileDeps): Promise<string[]> {
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
  // 한 이름씩 차례로 한다. 같은 공통 묶음을 이름마다 다시 읽고 고친다
  await sequentially(pending, async (line) => {
    const names = await deps.commonNames();
    if (!names.ok) {
      deps.logger.warn("plugin.migration.common_unreadable", { name: line.name });
      return;
    }
    if (!names.value.includes(line.name)) {
      const fact = deps.factOf(line.name);
      if (fact === undefined) return;
      const added = await deps.addToCommon(fact);
      if (!added.ok) {
        deps.logger.warn("plugin.migration.common_failed", {
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
