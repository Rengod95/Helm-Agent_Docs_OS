import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import type { ExtListEntry } from "@fresnel/contracts/wire";
import { renderToString } from "react-dom/server";
import { reduceMirror } from "../../../src/state/engine/reduce.ts";
import { INITIAL_MIRROR } from "../../../src/state/engine/state.ts";
import { createUiStore } from "../../../src/state/ui/store.ts";
import { Providers } from "../../../src/views/providers.tsx";
import {
  ThreadSwitches,
  ThreadSwitchesBody,
  type ThreadListLoad,
} from "../../../src/views/plugin/thread-switches.tsx";
import { entry, seededEngine } from "../workbench/support.tsx";
import { harness, SUB, STORE, thr } from "../../state/helpers.ts";
import { fakeCommands } from "../fake-commands.ts";

// "이 대화의 플러그인" 구역(플러그인 탭 맨 위)을 값으로 본다. M5c-1부터 켜짐은 이 대화의 프로필이 정하므로 구역은 읽기만 한다.
// 서버 렌더는 효과를 돌리지 않으므로 읽은 뒤의 행은 `ThreadSwitchesBody`에 목록을 넣어 그린다.

const THREAD = thr(1);
const HELM = entry("helm", { layer: "L3", isOrchestration: true, displayName: "Helm" });
const WEB = entry("web", { displayName: "웹 검색" });
const CORE = entry("core-loop", { layer: "L1", tier: "core", origin: "builtin" });

/** 열린 대화가 있는 엔진 거울의 읽기 면. 서버 렌더는 처음 상태를 읽으므로 대화를 연 거울을 처음 상태로 둔다 */
function openThreadEngine() {
  const live = reduceMirror(INITIAL_MIRROR, {
    type: "subscribed",
    sub: SUB,
    storeId: STORE,
    start: 5,
    live: true,
    from: "head",
  }).state;
  return seededEngine(reduceMirror(live, { type: "transcript_opening", threadId: THREAD }).state);
}

const textOf = (html: string): string => html.replace(/<!--.*?-->/g, "").replace(/<[^>]*>/g, "");

/** 행 하나의 HTML: 이름 글이 든 `li` 조각 */
function rowOf(html: string, name: string): string {
  const parts = html.split("<li");
  const found = parts.find((part) => part.includes(name));
  return found ?? "";
}

function body(
  list: ThreadListLoad,
  over: { readonly threadOpen?: boolean; readonly link?: "live" | "offline" | "pending" } = {},
): string {
  return renderToString(
    <ThreadSwitchesBody
      threadOpen={over.threadOpen ?? true}
      link={over.link ?? "live"}
      list={list}
    />,
  );
}

const ready = (...entries: ExtListEntry[]): ThreadListLoad => ({ kind: "ready", entries });

describe("이 대화의 플러그인 구역: 열린 대화의 행(읽기만)", () => {
  test("켜진 행은 이름만 보이고, 배지도 적용 대기도 없고, 조작할 스위치를 그리지 않는다", () => {
    const html = body(ready(HELM, WEB));
    expect(textOf(html)).toContain("Helm");
    expect(textOf(html)).toContain("웹 검색");
    expect(html).not.toContain("aria-checked");
    expect(html).not.toContain(t("desktop.plugin.thread.off"));
    expect(html).not.toContain(t("desktop.plugin.thread.appliesAt"));
  });

  test("이 대화에서 꺼진 행은 '꺼짐' 배지를 단다", () => {
    const off = entry("web", { displayName: "웹 검색", registration: "disabled" });
    const html = body(ready(HELM, off));
    expect(textOf(rowOf(html, "웹 검색"))).toContain(t("desktop.plugin.thread.off"));
    expect(textOf(rowOf(html, "Helm"))).not.toContain(t("desktop.plugin.thread.off"));
  });

  test("경계를 기다리는 행은 적용 대기 한 줄을 보이고 꺼짐 배지는 달지 않는다", () => {
    const disabling = entry("web", { displayName: "웹 검색", registration: "disabling" });
    const web = textOf(rowOf(body(ready(disabling)), "웹 검색"));
    expect(web).toContain(t("desktop.plugin.thread.appliesAt"));
    expect(web).not.toContain(t("desktop.plugin.thread.off"));
  });

  test("면제 tier 행은 그리지 않고, 남은 행이 없으면 빈 글 한 줄을 보인다", () => {
    const html = body(ready(CORE));
    expect(html).not.toContain("core-loop");
    expect(textOf(html)).toContain(t("desktop.plugin.thread.empty"));
  });
});

describe("이 대화의 플러그인 구역: 대화 없음, 읽는 중, 오류, 끊김", () => {
  test("열린 대화가 없으면 한 줄만 보이고 행은 없다", () => {
    const html = body({ kind: "idle" }, { threadOpen: false });
    expect(textOf(html)).toContain(t("desktop.plugin.thread.noThread"));
    expect(html).not.toContain("aria-checked");
  });

  test("목록을 읽는 중이면 Skeleton, 읽기가 실패하면 오류 한 줄을 보인다", () => {
    expect(body({ kind: "loading" })).toContain('data-slot="skeleton"');
    const failed = body({ kind: "error" });
    expect(textOf(failed)).toContain(t("desktop.plugin.thread.loadFailed"));
    expect(failed).not.toContain("aria-checked");
  });

  test("연결이 끊기면 끊김 글 한 줄만 보인다", () => {
    const html = body(ready(WEB), { link: "offline" });
    expect(textOf(html)).toContain(t("desktop.runtime.offline"));
    expect(html).not.toContain("aria-checked");
  });

  test("컨테이너는 열린 대화에서 읽기 전 Skeleton을, 대화가 없으면 한 줄을 그린다", () => {
    const opened = renderToString(
      <Providers engine={openThreadEngine()} ui={createUiStore().read} commands={fakeCommands()}>
        <ThreadSwitches />
      </Providers>,
    );
    expect(opened).toContain(t("desktop.plugin.thread.title"));
    expect(opened).toContain('data-slot="skeleton"');

    const closed = renderToString(
      <Providers engine={harness().store.read} ui={createUiStore().read} commands={fakeCommands()}>
        <ThreadSwitches />
      </Providers>,
    );
    expect(textOf(closed)).toContain(t("desktop.plugin.thread.noThread"));
    expect(closed).not.toContain("aria-checked");
  });
});
