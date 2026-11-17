import type { Result } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type {
  MaterialPort,
  MaterialText,
  McpServerMaterial,
  SkillRootMaterial,
} from "@fresnel/contracts/extensions";
import type { FolderRejection, PluginFolder } from "./folder-reader.ts";

// 대화의 재료 공급(M5c §4.5.10). 대화의 켜짐 집합에 든 플러그인의 재료만 낸다.
// 어느 폴더를 읽을지는 호출자가 정한다(`treeOf`). 다음 층이 검토본 사본 경로로 잇는다.

export interface MaterialPortDeps {
  /** 대화의 켜짐 집합(E(T))에 든 플러그인 이름 */
  readonly pluginSet: (threadId: ThreadId) => readonly string[];
  /** 이름의 폴더. 없으면 null이고 그 플러그인은 재료가 없다 */
  readonly treeOf: (name: string) => string | null;
  /** 폴더 읽기. 동기 함수다(재료 포트가 동기다) */
  readonly read: (dir: string) => Result<PluginFolder, FolderRejection>;
  /**
   * 읽지 못한 플러그인을 알린다. 재료 포트는 `Result`를 돌려줄 수 없어서 실패를 빈 재료로 숨기지 않고 여기로 넘긴다.
   * 같은 폴더는 한 번만 알린다
   */
  readonly report: (name: string, rejection: FolderRejection) => void;
}

interface Loaded {
  readonly name: string;
  readonly dir: string;
  readonly folder: PluginFolder;
}

/**
 * 재료 포트를 만든다. 읽은 결과는 폴더 경로별로 캐시한다. 검토본 사본은 고정(읽기 전용)이라 경로가 곧 내용의 식별자다.
 * 같은 경로를 다른 내용으로 바꾸는 호출자는 이 캐시와 함께 쓸 수 없다.
 */
export function createMaterialPort(deps: MaterialPortDeps): MaterialPort {
  const cache = new Map<string, Result<PluginFolder, FolderRejection>>();

  function load(name: string): Loaded | undefined {
    const dir = deps.treeOf(name);
    if (dir === null) return undefined;
    let outcome = cache.get(dir);
    if (outcome === undefined) {
      outcome = deps.read(dir);
      cache.set(dir, outcome);
      if (!outcome.ok) deps.report(name, outcome.error);
    }
    return outcome.ok ? { name, dir, folder: outcome.value } : undefined;
  }

  function loadedFor(threadId: ThreadId): Loaded[] {
    const loaded: Loaded[] = [];
    for (const name of deps.pluginSet(threadId)) {
      const item = load(name);
      if (item !== undefined) loaded.push(item);
    }
    return loaded;
  }

  return {
    instructions(threadId: ThreadId): readonly MaterialText[] {
      return loadedFor(threadId).flatMap(({ name, folder }) =>
        folder.materials.instructions.map((item) => ({
          key: `plugin:${name}:${item.path}`,
          text: item.text,
        })),
      );
    },
    skillRoots(threadId: ThreadId): readonly SkillRootMaterial[] {
      return loadedFor(threadId)
        .filter(({ folder }) => folder.materials.skills.length > 0)
        .map(({ name, dir }) => ({ plugin: name, dir }));
    },
    agentDefinitions(threadId: ThreadId): readonly MaterialText[] {
      return loadedFor(threadId).flatMap(({ name, folder }) =>
        folder.materials.agents.map((item) => ({
          key: `plugin:${name}:${item.path}`,
          text: item.text,
        })),
      );
    },
    mcpServers(threadId: ThreadId): readonly McpServerMaterial[] {
      return loadedFor(threadId).flatMap(({ name, folder }) =>
        folder.materials.mcpServers.map((server) => ({
          plugin: name,
          name: server.name,
          config: server.config,
        })),
      );
    },
    commands(threadId: ThreadId): readonly MaterialText[] {
      return loadedFor(threadId).flatMap(({ name, folder }) =>
        folder.materials.commands.map((item) => ({
          key: `plugin:${name}:${item.path}`,
          text: item.text,
        })),
      );
    },
  };
}
