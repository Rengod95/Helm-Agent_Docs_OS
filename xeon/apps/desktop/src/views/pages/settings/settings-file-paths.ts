import { t } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { useEffect, useState } from "react";
import { useCommands } from "../../commands.ts";

// 개요의 "설정 파일" 목록(P-09 시안 `overview-tab.tsx`). 경로는 `settings.readFile`의 `path`로만 얻는다(엔진이 범위마다 정한다).
// 프로젝트 파일은 작업 폴더가 있어야 정해져, 대화가 없으면 경로가 null이고 그 줄은 그리지 않는다.

export type SettingsPathScope = "user" | "project" | "managed";

export interface SettingsPathRow {
  readonly scope: SettingsPathScope;
  readonly path: string;
}

const ORDER: readonly SettingsPathScope[] = ["user", "project", "managed"];

/** 범위 이름(번역) */
export function pathTermOf(scope: SettingsPathScope): string {
  if (scope === "user") return t("desktop.settings.overview.files.user");
  if (scope === "project") return t("desktop.settings.overview.files.project");
  return t("desktop.settings.overview.files.managed");
}

/** 연결이 살아 있을 때 사용자·프로젝트·관리 정책 파일의 경로를 읽는다. 대화가 바뀌면 다시 읽고, 옛 응답은 버린다 */
export function useSettingsFilePaths(
  live: boolean,
  threadId: ThreadId | null,
): readonly SettingsPathRow[] {
  const commands = useCommands();
  const [rows, setRows] = useState<readonly SettingsPathRow[]>([]);
  useEffect(() => {
    if (!live) return undefined;
    let current = true;
    const read = async (): Promise<void> => {
      const found = await Promise.all(
        ORDER.map(async (scope): Promise<SettingsPathRow | null> => {
          const result = await commands.settings.readFile({ scope, threadId });
          return result.ok && result.value.path !== null
            ? { scope, path: result.value.path }
            : null;
        }),
      );
      if (!current) return;
      setRows(found.filter((row): row is SettingsPathRow => row !== null));
    };
    detach(read(), rethrow);
    return () => {
      current = false;
    };
  }, [commands, live, threadId]);
  return live ? rows : [];
}
