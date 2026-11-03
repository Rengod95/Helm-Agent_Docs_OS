import { attemptAsync, detach, rethrow } from "@fresnel/contracts";
import { BRIDGE_VERSION, type UiNode } from "@fresnel/contracts/extensions";
import type { ScreenLedger } from "@fresnel/client/views/ledger";
import { resolveTree, type ResolvedTree } from "@fresnel/client/views/native";
import {
  decide,
  type ActionRunner,
  type BridgePolicyContext,
  type RunnableAction,
} from "@fresnel/client/views/app";
import type { NativeTreeActions } from "./native-tree.tsx";

// 선언형 화면의 두 길: 데이터 읽기(`readTreeOf`)와 버튼 명령(`treeActionsOf`). 둘 다 `decide`를 거치고 실행기(`ActionRunner`)로 간다.
// React와 DOM이 없어서 시험이 화면과 같은 길(연결 대역 → 백엔드 → 실행기 → 확인 줄)을 그대로 돈다.

/** 한 동작을 판정(`decide`)하고 실행기로 돌린다. 판정이 거부하면 실행하지 않는다. 팔레트 명령도 이 길을 쓴다 */
export async function runDecided(
  runner: ActionRunner,
  context: BridgePolicyContext,
  op: "query" | "host" | "command",
  args: unknown,
): Promise<{ readonly ok: true; readonly value: unknown } | { readonly ok: false }> {
  const decision = decide({ v: BRIDGE_VERSION, id: 0, op, args }, context);
  if (!decision.ok || decision.action.op === "pong") return { ok: false };
  const action: RunnableAction = decision.action;
  const result = await runner.run(action);
  return result.ok ? { ok: true, value: result.value } : { ok: false };
}

/**
 * 선언형 화면의 데이터 문서. 뿌리 키는 읽기 전용 메서드 동사(`/status/...`)와 `host`다.
 * 프레임의 `query`와 같은 길(`decide`, 실행기의 결과 크기 상한과 장부)을 거치고, 읽기는 하나씩 차례로 한다
 */
async function readDoc(
  runner: ActionRunner,
  context: BridgePolicyContext,
): Promise<Record<string, unknown> | undefined> {
  const verbs = [...context.methods].filter(([, grant]) => grant.readOnly).map(([verb]) => verb);
  const doc: Record<string, unknown> = {};
  await verbs.reduce<Promise<void>>(async (before, verb) => {
    await before;
    const result = await runDecided(runner, context, "query", { verb });
    if (result.ok) doc[verb] = result.value;
  }, Promise.resolve());
  if (verbs.length > 0 && Object.keys(doc).length === 0) return undefined;
  const host = await runDecided(runner, context, "host", {});
  if (host.ok) doc["host"] = host.value;
  return doc;
}

/**
 * 데이터 문서를 읽어 트리를 자른다. 문서를 못 읽으면 undefined다(던지지 않는다). 시각과 말투는 호출자가 준다
 */
export async function readTreeOf(
  runner: ActionRunner,
  context: BridgePolicyContext,
  tree: UiNode,
  view: {
    readonly locale: string;
    readonly nowMs: number;
    readonly messages?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  },
): Promise<ResolvedTree | undefined> {
  const doc = await attemptAsync(() => readDoc(runner, context));
  if (!doc.ok || doc.value === undefined) return undefined;
  return resolveTree(tree, {
    doc: doc.value,
    locale: view.locale,
    nowMs: view.nowMs,
    ...(view.messages === undefined ? {} : { messages: view.messages }),
  });
}

/**
 * 선언형 화면의 동작 묶음. `Button`·`Form`의 명령은 `command` 동작으로 실행기를 거치고(확인 줄, 쿨다운, 장부),
 * 대화 링크는 `openChat`으로 간다. 외부 링크는 확인 줄이 아직 없어 열지 않는다
 */
export function treeActionsOf(options: {
  readonly runner: ActionRunner;
  readonly context: () => BridgePolicyContext;
  readonly ledger: ScreenLedger;
  readonly screenKey: string;
  readonly openChat: () => void;
}): NativeTreeActions {
  const { runner, context, ledger, screenKey, openChat } = options;
  return {
    runCommand(name, values) {
      const args = Object.entries(values)
        .map(([field, value]) => `${field}=${String(value)}`)
        .join(" ");
      // 프레임의 `command`와 같은 길이다: `decide`(자기 확장이 등록한 명령만), 확인 줄, 쿨다운, 장부
      const run = async (): Promise<void> => {
        const done = await runDecided(runner, context(), "command", { name, args });
        if (done.ok) ledger.succeed(screenKey);
      };
      detach(run(), rethrow);
    },
    openLink(link) {
      if (link.kind === "thread") openChat();
    },
  };
}
