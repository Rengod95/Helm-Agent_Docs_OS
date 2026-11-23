import { describe, expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
import { ExtUiChangedParamsSchema } from "@fresnel/contracts/wire";
import { onExtensionChanged } from "../../../src/views/plugin/own-view.ts";

// 본보기 칸반 화면이 바뀜 알림을 받아 프레임에 `invalidate`를 미는 지점(ADR-0021 §3.4.2).
// 입력과 기대 값은 `apps/host/test/handlers/kanban-ui-changes.test.ts`의 마지막 단계와 같다: 호스트가 보내는 `ext.ui.changed { extension: "kanban" }`.
// `plugin-view.tsx`의 `FrameBody`가 `changes`를 만드는 식과 `PluginFrameMount`가 그 listener에서 push하는 식을 그대로 옮긴다.

/** 호스트가 보내는 알림의 값. 와이어 모양은 contracts `ExtUiChangedParamsSchema`다 */
const CHANGED = { extension: "kanban" };

/** `commands.pluginUi.onChanged` 대역: 구독한 listener를 기억하고, 구독을 끊으면 지운다 */
function fakeOnChanged(): {
  readonly onChanged: (listener: (extension: string) => void) => () => void;
  deliver(extension: string): void;
  readonly listening: () => number;
} {
  const listeners = new Set<(extension: string) => void>();
  return {
    onChanged(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    deliver(extension) {
      for (const listener of listeners) listener(extension);
    },
    listening: () => listeners.size,
  };
}

/** 프레임 push 대역: 프레임 쪽에 민 `[종류, 값]`을 기록한다 */
function fakeFrame(): {
  readonly push: (kind: string, value: unknown) => void;
  readonly sent: unknown[];
} {
  const sent: unknown[] = [];
  return {
    push(kind, value) {
      sent.push([kind, value]);
    },
    sent,
  };
}

/** `FrameBody`의 `changes`와 `PluginFrameMount`의 효과를 합친 것. 이 확장이 바뀌면 프레임에 값 없는 invalidate를 민다 */
function framePushOnChange(
  changed: ReturnType<typeof fakeOnChanged>,
  frame: ReturnType<typeof fakeFrame>,
  extension: string,
): () => void {
  const changes = (listener: () => void) =>
    onExtensionChanged((next) => changed.onChanged(next), extension, listener);
  return changes(() => {
    frame.push("invalidate", null);
  });
}

describe("the kanban change notification reaches the kanban frame as one invalidate", () => {
  test("the notification's value is the wire shape", () => {
    expect(parse(ExtUiChangedParamsSchema, CHANGED)).toEqual({ ok: true, value: CHANGED });
  });

  test("the kanban notification pushes one invalidate with no value, and another extension's notification pushes nothing", () => {
    const changed = fakeOnChanged();
    const frame = fakeFrame();
    framePushOnChange(changed, frame, "kanban");
    changed.deliver("notes");
    expect(frame.sent).toEqual([]);
    changed.deliver(CHANGED.extension);
    expect(frame.sent).toEqual([["invalidate", null]]);
  });

  test("a frame that closed unsubscribes, and later kanban notifications push nothing", () => {
    const changed = fakeOnChanged();
    const frame = fakeFrame();
    const off = framePushOnChange(changed, frame, "kanban");
    expect(changed.listening()).toBe(1);
    off();
    expect(changed.listening()).toBe(0);
    changed.deliver(CHANGED.extension);
    expect(frame.sent).toEqual([]);
  });
});
