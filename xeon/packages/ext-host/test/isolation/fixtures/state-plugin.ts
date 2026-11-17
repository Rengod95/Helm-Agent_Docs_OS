// 격리 상태 시험의 플러그인 픽스처. 상태 버전 2이고 `migrateState`로 버전 1 문서 `{n}`을 옮긴다(비동기 함수).
// 명령 `bump`는 `updateState`로 1을 더한다. `hold`는 `release`가 풀 때까지 기다린 뒤 `updateState`를 한다(충돌 시험).
// `twice`는 두 `updateState`를 동시에 낸다(같은 줄 안에서 서로를 덮지 않는다).
import { Type } from "typebox";
import { parse, type Result } from "@fresnel/contracts";
import type { ExtensionEntry } from "@fresnel/contracts/extensions";
import { hostOf } from "../../../src/index.ts";

const V1 = Type.Object({ n: Type.Integer({ minimum: 0 }) });
const V2 = Type.Object({ count: Type.Integer({ minimum: 0 }), label: Type.String() });

/** 명령 응답 문장: 성공이면 센 값, 실패면 실패 종류 */
function countText(result: Result<{ readonly count: number }, { readonly kind: string }>): string {
  return result.ok ? `count ${result.value.count}` : `failed ${result.error.kind}`;
}

const bump = (prev: { readonly count: number; readonly label: string }) => ({
  count: prev.count + 1,
  label: prev.label,
});

export const extension: ExtensionEntry = ({ register }) => {
  register(
    "sv",
    { state: { schema: V2, initial: { count: 0, label: "" }, version: 2 }, defaultEnabled: true },
    (g) => {
      const host = hostOf(g);
      const hold = Promise.withResolvers<void>();
      const held = hold.promise;
      host.migrateState(async (doc, fromVersion) => {
        await Promise.resolve();
        const old = parse(V1, doc);
        return { count: old.ok ? old.value.n : 0, label: `from ${fromVersion}` };
      });
      host.registerCommand("bump", {
        handler: async () => countText(await host.updateState(bump)),
      });
      host.registerCommand("twice", {
        handler: async () => {
          const [first, second] = await Promise.all([
            host.updateState(bump),
            host.updateState(bump),
          ]);
          return `${countText(first)} ${countText(second)}`;
        },
      });
      host.registerCommand("hold", {
        handler: async () => {
          await held;
          return countText(await host.updateState(bump));
        },
      });
      host.registerCommand("release", {
        handler: async () => {
          await Promise.resolve();
          hold.resolve();
          return "released";
        },
      });
    },
  );
};
