import { t } from "@fresnel/client/i18n";
import { detach, rethrow, type Result } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { useEffect, useState } from "react";
import { useThreadSummaries } from "../../../state/engine/index.ts";
import { useCommands, type CommandError } from "../../commands.ts";

// 개요의 "설정 파일" 목록(P-09 시안 `overview-tab.tsx`). 경로는 `settings.readFile`의 `path`로만 얻는다(엔진이 범위마다 정한다).
// 줄은 사용자·프로젝트·관리 정책 셋이 늘 있다. 경로를 모르면(null, 읽기 실패 포함) 그 줄은 `없음`으로 보인다.
// 프로젝트 파일은 작업 폴더가 있어야 정해진다. 열린 대화가 없으면 작업 폴더가 있는 가장 최근 대화의 폴더를 쓴다(`pathThreadIdOf`).
// 작업 폴더가 있는 대화가 하나도 없으면 프로젝트 경로는 null이다.

export type SettingsPathScope = "user" | "project" | "managed";

/** 줄의 순서. 시안 `overview-tab.tsx`와 같다 */
export const PATH_SCOPES: readonly SettingsPathScope[] = ["user", "project", "managed"];

export interface SettingsPathRow {
  readonly scope: SettingsPathScope;
  /** 파일 경로. 알 수 없으면 null이다(작업 폴더 없는 프로젝트 범위, 읽기 실패) */
  readonly path: string | null;
}

/** 프로젝트 경로를 읽을 대화를 고르는 데 필요한 `ThreadSummary`의 세 칸 */
export interface PathThreadCandidate {
  readonly threadId: ThreadId;
  /** 작업 폴더 절대 경로. 없으면 null */
  readonly workspace: string | null;
  /** 마지막 이벤트 시각(ISO 문자열). 같은 형식이라 문자열 순서가 시간 순서다 */
  readonly updatedAt: string;
}

/** 범위 이름(번역) */
export function pathTermOf(scope: SettingsPathScope): string {
  if (scope === "user") return t("desktop.settings.overview.files.user");
  if (scope === "project") return t("desktop.settings.overview.files.project");
  return t("desktop.settings.overview.files.managed");
}

/**
 * 화면에 보이는 경로의 사용자 홈을 `~`로 줄인다(시안: `~/.fresnel/settings.json`).
 * 클라이언트는 홈 디렉터리 값을 받지 않아(host.hello에도 없다) macOS·Linux의 `/Users/<이름>`, `/home/<이름>` 모양만 알아본다.
 * 그래서 다른 사용자의 홈 아래 경로도 줄어든다. 복사에는 줄이지 않은 원래 경로를 쓴다.
 */
export function shortenHome(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, "~");
}

/**
 * 프로젝트 파일을 읽을 대화를 고른다. 열린 대화가 있으면 그 대화다(작업 폴더가 없으면 프로젝트 경로는 null이라 `없음`으로 보인다).
 * 열린 대화가 없으면 작업 폴더가 있는 대화 가운데 가장 최근에 갱신된 대화다. 같은 시각이면 목록에서 먼저 나온 대화다.
 * 그런 대화가 없으면 null이다.
 */
export function pathThreadIdOf(
  openThreadId: ThreadId | null,
  threads: readonly PathThreadCandidate[],
): ThreadId | null {
  if (openThreadId !== null) return openThreadId;
  let latest: PathThreadCandidate | null = null;
  for (const thread of threads) {
    if (thread.workspace === null) continue;
    if (latest === null || thread.updatedAt > latest.updatedAt) latest = thread;
  }
  return latest === null ? null : latest.threadId;
}

/**
 * 범위 하나의 `settings.readFile` 결과를 줄로 바꾼다. 읽지 못했으면 경로를 모르는 것이라 null이다.
 * 파일이 없어도(`exists`가 거짓) 경로가 있으면 줄은 그 경로를 그대로 보인다.
 */
export function pathRowOf(
  scope: SettingsPathScope,
  result: Result<{ readonly path: string | null }, CommandError>,
): SettingsPathRow {
  return { scope, path: result.ok ? result.value.path : null };
}

/**
 * 연결이 살아 있을 때 사용자·프로젝트·관리 정책 파일의 경로 줄 셋을 읽는다. 읽을 대화가 바뀌면 다시 읽고, 옛 응답은 버린다.
 * `openThreadId`는 열린 대화다. 없으면 `pathThreadIdOf`가 고른 대화로 읽는다.
 */
export function useSettingsFilePaths(
  live: boolean,
  openThreadId: ThreadId | null,
): readonly SettingsPathRow[] {
  const commands = useCommands();
  const threads = useThreadSummaries();
  const threadId = pathThreadIdOf(openThreadId, threads);
  const [rows, setRows] = useState<readonly SettingsPathRow[]>([]);
  useEffect(() => {
    if (!live) return undefined;
    let current = true;
    const read = async (): Promise<void> => {
      const found = await Promise.all(
        PATH_SCOPES.map(async (scope): Promise<SettingsPathRow> => {
          const result = await commands.settings.readFile({ scope, threadId });
          return pathRowOf(scope, result);
        }),
      );
      if (!current) return;
      setRows(found);
    };
    detach(read(), rethrow);
    return () => {
      current = false;
    };
  }, [commands, live, threadId]);
  return live ? rows : [];
}
