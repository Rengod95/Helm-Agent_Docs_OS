import { describe, expect, test } from "bun:test";
import { policyContextOf } from "../../../src/plugin-ui/policy-context.ts";
import { createSession } from "../../../src/views/plugin/plugin-view.tsx";
import { extGetOf, uiEntryOf } from "../../plugin-ui/support.ts";
import { thr } from "../../state/helpers.ts";
import { emptyPluginUi } from "./support.tsx";

// 다리의 `navigate { view }`가 열기 함수를 부르는 길을 값으로 본다. 열기 함수가 거짓이면 다리는 `navigate_unsupported`로 답한다.

const PHASE = uiEntryOf({ id: "phase", placement: "page", title: "단계" });

describe("navigate { view } asks the open function and reports what it answers", () => {
  test("a view the open function takes is moved to, a refused one answers unsupported", async () => {
    const built = policyContextOf({
      get: extGetOf(),
      entry: PHASE,
      openThreadId: thr(1),
      commands: [],
    });
    if (!built.ok) throw new Error(`policy context: ${built.error.kind}`);
    const opened: string[] = [];
    const session = createSession(
      PHASE,
      built.value,
      null,
      () => {},
      () => null,
      emptyPluginUi().runtime,
      () => Promise.resolve(),
      undefined,
      (view) => {
        opened.push(view);
        return view === "board";
      },
    );
    const backend = session.makeBackend(() => {});
    const moved = await backend.navigate({ kind: "view", id: "board" }, false);
    const refused = await backend.navigate({ kind: "view", id: "nope" }, false);
    expect(opened).toEqual(["board", "nope"]);
    expect(moved.ok).toBe(true);
    expect(refused.ok).toBe(false);
  });
});
