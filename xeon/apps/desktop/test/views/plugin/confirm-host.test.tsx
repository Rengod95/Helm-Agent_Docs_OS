import { describe, expect, test } from "bun:test";
import { CONFIRM_CLICK_GUARD_MS, type ConfirmRequest } from "@fresnel/client/views/app";
import { renderToString } from "react-dom/server";
import {
  ConfirmDialogView,
  ConfirmHost,
  confirmActivation,
  createConfirmQueue,
  type ConfirmQueue,
  type ConfirmQueueItem,
} from "../../../src/views/plugin/confirm-host.tsx";

const noop = (): void => {};

function request(patch: Partial<ConfirmRequest>): ConfirmRequest {
  return {
    extension: "helm",
    trust: "builtin",
    action: "runTask",
    label: undefined,
    paramsSummary: "",
    approval: false,
    ...patch,
  };
}

const ALPHA = request({ action: "alpha" });
const BETA = request({ action: "beta" });
const GAMMA = request({ action: "gamma" });

function headOf(queue: ConfirmQueue): ConfirmQueueItem {
  const item = queue.current();
  if (item === undefined) throw new Error("no confirm line is shown");
  return item;
}

/** React 서버 렌더가 쓰는 글자 참조를 되돌려 글을 그대로 비교한다 */
function decoded(html: string): string {
  return html
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

/** 단추 여는 태그의 속성과 글을 차례로 모은다 */
function buttonsOf(html: string): readonly { readonly attrs: string; readonly label: string }[] {
  return [...html.matchAll(/<button\b([^>]*)>([^<]*)<\/button>/g)].map((match) => ({
    attrs: match[1] ?? "",
    label: match[2] ?? "",
  }));
}

describe("createConfirmQueue", () => {
  test("shows one request at a time and a second request waits behind the first", async () => {
    const queue = createConfirmQueue();
    const first = queue.request(ALPHA);
    const second = queue.request(BETA);
    expect(headOf(queue).request).toBe(ALPHA);

    headOf(queue).answer("allow");
    expect(await first).toBe("allow");
    expect(headOf(queue).request).toBe(BETA);

    headOf(queue).answer("deny");
    expect(await second).toBe("deny");
    expect(queue.current()).toBeUndefined();
  });

  test("a second answer to a settled request changes nothing", async () => {
    const queue = createConfirmQueue();
    const first = queue.request(ALPHA);
    void queue.request(BETA);
    const old = headOf(queue);
    old.answer("allow");
    old.answer("deny");
    expect(await first).toBe("allow");
    expect(headOf(queue).request).toBe(BETA);
  });

  test("cancel resolves a shown request as deny and shows the next one", async () => {
    const queue = createConfirmQueue();
    const first = queue.request(ALPHA);
    const second = queue.request(BETA);
    queue.cancel(ALPHA);
    expect(await first).toBe("deny");
    expect(headOf(queue).request).toBe(BETA);
    expect(await Promise.race([second, Promise.resolve("pending")])).toBe("pending");
  });

  test("cancel removes a waiting request so it never reaches the screen", async () => {
    const queue = createConfirmQueue();
    void queue.request(ALPHA);
    const waiting = queue.request(BETA);
    void queue.request(GAMMA);
    queue.cancel(BETA);
    expect(await waiting).toBe("deny");
    headOf(queue).answer("allow");
    expect(headOf(queue).request).toBe(GAMMA);
  });

  test("cancel of an unknown request changes nothing", () => {
    const queue = createConfirmQueue();
    void queue.request(ALPHA);
    queue.cancel(BETA);
    expect(headOf(queue).request).toBe(ALPHA);
  });

  test("subscribers hear each change of the shown request until they unsubscribe", () => {
    const queue = createConfirmQueue();
    let heard = 0;
    const unsubscribe = queue.subscribe(() => {
      heard += 1;
    });
    void queue.request(ALPHA);
    void queue.request(BETA);
    expect(heard).toBe(1);
    headOf(queue).answer("deny");
    expect(heard).toBe(2);
    unsubscribe();
    headOf(queue).answer("deny");
    expect(heard).toBe(2);
  });
});

describe("confirmActivation", () => {
  test("ignores both answers before the guard time and passes them at the guard time", () => {
    expect(CONFIRM_CLICK_GUARD_MS).toBe(500);
    expect(confirmActivation(0, 499, "allow")).toBe("ignored");
    expect(confirmActivation(0, 500, "allow")).toBe("allow");
    expect(confirmActivation(0, 499, "deny")).toBe("ignored");
    expect(confirmActivation(0, 500, "deny")).toBe("deny");
  });

  test("counts from the moment the line appeared", () => {
    expect(confirmActivation(10_000, 10_499, "allow")).toBe("ignored");
    expect(confirmActivation(10_000, 10_500, "allow")).toBe("allow");
  });

  test("a clock that did not advance, or a NaN reading, does not pass the guard", () => {
    expect(confirmActivation(5, 4, "allow")).toBe("ignored");
    expect(confirmActivation(0, Number.NaN, "allow")).toBe("ignored");
  });
});

describe("ConfirmDialogView", () => {
  test("shows the line text, the trust and project badges, and the params summary", () => {
    const html = decoded(
      renderToString(
        <ConfirmDialogView
          inline
          request={request({
            trust: "project",
            action: "runTask",
            paramsSummary: 'path=/work/a, mode="read"',
          })}
          onAnswer={noop}
          onDismiss={noop}
        />,
      ),
    );
    expect(html).toContain('"helm" 확장이 "runTask" 동작을 하려고 해요');
    expect(html).toContain("이 프로젝트에서 옴");
    expect(html).toContain(">프로젝트<");
    expect(html).toContain('path=/work/a, mode="read"');
  });

  test("uses the manifest label in place of the action name when one is given", () => {
    const html = decoded(
      renderToString(
        <ConfirmDialogView
          inline
          request={request({ label: "작업 실행" })}
          onAnswer={noop}
          onDismiss={noop}
        />,
      ),
    );
    expect(html).toContain('"helm" 확장이 "작업 실행" 동작을 하려고 해요');
    expect(html).not.toContain('"runTask"');
  });

  test("marks deny as the one default focus and leaves allow unmarked", () => {
    const buttons = buttonsOf(
      renderToString(
        <ConfirmDialogView inline request={request({})} onAnswer={noop} onDismiss={noop} />,
      ),
    );
    expect(buttons.map((button) => button.label)).toEqual(["허용", "거부"]);
    const focused = buttons.filter((button) => button.attrs.includes('data-default-focus="true"'));
    expect(focused.map((button) => button.label)).toEqual(["거부"]);
  });

  test("draws no params line when the summary is empty", () => {
    const html = renderToString(
      <ConfirmDialogView
        inline
        request={request({ paramsSummary: "" })}
        onAnswer={noop}
        onDismiss={noop}
      />,
    );
    expect(html).not.toContain("break-all");
  });
});

describe("ConfirmHost", () => {
  test("draws nothing while no request is waiting", () => {
    expect(renderToString(<ConfirmHost queue={createConfirmQueue()} />)).toBe("");
  });
});
