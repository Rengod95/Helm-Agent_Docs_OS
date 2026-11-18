import type { ThreadId } from "@fresnel/contracts/conversation";
import {
  wireError,
  type CraftChatOpenParams,
  type ThreadSummary,
  type WireHandler,
} from "@fresnel/contracts/wire";
import type { ConnectionHub } from "../../connection-types.ts";
import type { CraftPluginError } from "@fresnel/contracts/records";
import { CRAFT_PROFILE_ID } from "../../assembly/m4/profile-defaults.ts";
import { canonicalWorkspace } from "../../assembly/workspace.ts";
import type { Engine } from "../../types.ts";
import { claimWrite } from "../owner.ts";

// 테스트 대화의 wire(M5c §3.6, §4.8.10): `craftChat.open`(열기, 없으면 만들기)과 `craftChat.list`(한 플러그인의 목록).
// 목록은 `thread.list { include: "craft" }`가 내는 대화 중 표지의 `plugin`이 같은 것이다. 묶이지 않은 대화는 `plugin: null`이다.
// 원본 폴더(`<설정>/plugins/<이름>`)가 있으면 대화의 작업 폴더로 쓰고, 없으면 작업 폴더 없이 만든다(§4.8.7 [제안]).

/** 목록 상한. `ThreadSummary` 목록의 상한과 같다(`thread.list`) */
const CRAFT_LIST_MAX = 200;

/** 테스트 대화 가운데 표지의 `plugin`이 `plugin`과 같은 것, 최신 먼저. 쪽마다 끝까지 읽되 상한에서 멈춘다 */
function craftThreadsOf(
  engine: Engine,
  plugin: string | null,
  cursor?: string,
  found: readonly ThreadSummary[] = [],
): Promise<ThreadSummary[]> {
  return engine.ports.threads
    .list({
      include: "craft",
      limit: 200,
      ...(cursor === undefined ? {} : { cursor }),
    })
    .then(async (page) => {
      const next = [
        ...found,
        ...page.threads.filter(
          (thread) => thread.craftChat !== undefined && thread.craftChat.plugin === plugin,
        ),
      ].slice(0, CRAFT_LIST_MAX);
      if (page.nextCursor === null || next.length === CRAFT_LIST_MAX) return next;
      return craftThreadsOf(engine, plugin, page.nextCursor, next);
    });
}

/** 원본 폴더가 있으면 그 정규 경로, 없으면 undefined다. 없는 폴더를 작업 폴더로 주면 `thread.create`가 거절하므로 여기서 거른다 */
async function existingFolderOf(engine: Engine, plugin: string): Promise<string | undefined> {
  const canonical = await canonicalWorkspace(engine.ports.craftChat.folderOf(plugin));
  return canonical.ok ? canonical.value : undefined;
}

/**
 * 열 때 맥락 참조를 남긴다(M5c §4.8.8). 참조가 있거나 한 줄 의도가 있을 때만 한 번 쓴다. 쓰지 못하면 `store.io`다.
 * 대화가 없어졌거나 닫혔으면 그 실패를 그대로 알린다(열기 자체는 이미 끝났다)
 */
function recordOpenContext(engine: Engine, threadId: ThreadId, params: CraftChatOpenParams): void {
  const refs = params.context ?? [];
  if (refs.length === 0 && params.intent === undefined) return;
  const written = engine.ports.craftChat.recordContext(threadId, {
    refs,
    intent: params.intent ?? null,
  });
  if (!written.ok) throw wireErrorOfCraftContext(written.error);
}

function wireErrorOfCraftContext(error: CraftPluginError) {
  return wireError("store.io", {
    message: `the craft context could not be recorded (${error.kind})`,
    details: { code: "io" },
  });
}

export function createCraftChatHandlers(
  engine: Engine,
  hub: () => ConnectionHub,
): {
  readonly "craftChat.open": WireHandler<"craftChat.open">;
  readonly "craftChat.list": WireHandler<"craftChat.list">;
} {
  return {
    "craftChat.open": async (params, context) => {
      const plugin = params.plugin;
      if (params.reuse === "last") {
        const latest = (await craftThreadsOf(engine, plugin))[0];
        if (latest !== undefined) {
          await claimWrite(engine, hub(), context.connectionId, latest.threadId);
          recordOpenContext(engine, latest.threadId, params);
          return { threadId: latest.threadId, plugin, reused: true };
        }
      }
      const folder = plugin === null ? undefined : await existingFolderOf(engine, plugin);
      const created = await engine.ports.threads.create({
        ...(folder === undefined ? {} : { workspace: folder }),
        ...(params.intent === undefined ? {} : { title: params.intent }),
        profileId: CRAFT_PROFILE_ID,
        craftChat: { plugin, contexts: [] },
      });
      await claimWrite(engine, hub(), context.connectionId, created.threadId);
      // 열기 훅의 대화 폴더는 쓰기 소유를 얻은 뒤, 첫 턴 전에 정한다(H-7). `thread.create`와 같은 순서다
      await engine.ports.threads.applyOpenWorkspace(created.threadId);
      recordOpenContext(engine, created.threadId, params);
      return { threadId: created.threadId, plugin, reused: false };
    },

    "craftChat.list": async (params) => ({
      threads: await craftThreadsOf(engine, params.plugin),
    }),
  };
}
