import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import type { ThreadToggleRequest } from "@fresnel/client/workbench";
import { err, ok, type Result } from "@fresnel/contracts";
import type { ExtListEntry } from "@fresnel/contracts/wire";
import { Switch, type ToastOptions } from "@caustic/react";
import { Children, isValidElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { reduceMirror } from "../../../src/state/engine/reduce.ts";
import { INITIAL_MIRROR } from "../../../src/state/engine/state.ts";
import { createUiStore } from "../../../src/state/ui/store.ts";
import type { CommandError } from "../../../src/views/commands.ts";
import { Providers } from "../../../src/views/providers.tsx";
import {
  ThreadSwitches,
  ThreadSwitchesBody,
  writeThreadSwitch,
  type ThreadListLoad,
  type ThreadSwitchPort,
} from "../../../src/views/plugin/thread-switches.tsx";
import { entry, seededEngine } from "../workbench/support.tsx";
import { harness, SUB, STORE, thr } from "../../state/helpers.ts";
import { fakeCommands } from "../fake-commands.ts";

// "이 대화에서 끄기" 구역(플러그인 탭 맨 위)을 값으로 본다. 서버 렌더는 효과를 돌리지 않으므로 읽은 뒤의 행은
// `ThreadSwitchesBody`에 목록을 넣어 그린다. 클릭은 그린 요소 트리에서 스위치의 `onCheckedChange`를 꺼내 부른다(DOM 없음).
// 쓰기는 `writeThreadSwitch`를 가짜 명령과 토스트로 부른다. 컨테이너는 읽기 전 상태(SSR)로 본다.

const THREAD = thr(1);
const HELM = entry("helm", { layer: "L3", isGroup: true, displayName: "Helm" });
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

const LABEL = (name: string): string => t("desktop.plugin.thread.switch.label", { name });

/** 태그와 주석을 뺀 글 */
const textOf = (html: string): string => html.replace(/<!--.*?-->/g, "").replace(/<[^>]*>/g, "");

/** 행(li) 하나의 마크업. 스위치 이름이 든 행을 고른다 */
function rowOf(html: string, name: string): string {
  return html.split("<li").find((part) => part.includes(`aria-label="${LABEL(name)}"`)) ?? "";
}

/** 스위치가 켜진 것으로 그린 개수 */
const countOn = (html: string): number => html.split('aria-checked="true"').length - 1;

function body(
  list: ThreadListLoad,
  over: {
    readonly threadOpen?: boolean;
    readonly link?: "live" | "offline" | "pending";
    readonly showing?: Readonly<Record<string, boolean>>;
  } = {},
): string {
  return renderToString(
    <ThreadSwitchesBody
      threadOpen={over.threadOpen ?? true}
      link={over.link ?? "live"}
      list={list}
      showing={over.showing ?? {}}
      onToggle={() => {}}
    />,
  );
}

const ready = (...entries: ExtListEntry[]): ThreadListLoad => ({ kind: "ready", entries });

type SwitchProps = {
  readonly "aria-label"?: string;
  readonly onCheckedChange?: (next: boolean) => void;
  readonly children?: ReactNode;
};

/** 그린 요소 트리에서 이름이 붙은 스위치의 속성. 클릭은 `onCheckedChange`를 부르는 것과 같다 */
function switchOf(node: ReactNode, label: string): SwitchProps | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<SwitchProps>(child)) continue;
    if (child.type === Switch && child.props["aria-label"] === label) return child.props;
    const inner = switchOf(child.props.children, label);
    if (inner !== undefined) return inner;
  }
  return undefined;
}

describe("이 대화에서 끄기 구역: 열린 대화의 행", () => {
  test("S1 모두 켜짐: 행마다 켜진 스위치가 있고 배지는 없다", () => {
    const html = body(ready(HELM, WEB));
    expect(textOf(html)).toContain("Helm");
    expect(textOf(html)).toContain("웹 검색");
    expect(countOn(html)).toBe(2);
    expect(html).not.toContain(t("desktop.plugin.thread.off"));
    expect(html).not.toContain(t("desktop.plugin.thread.appliesAt"));
  });

  test("S2 하나를 이 대화에서 끄면 그 행에 '이 대화에서 꺼짐' 배지가 붙고 스위치는 꺼진다", () => {
    const off = entry("web", { displayName: "웹 검색", registration: "disabled" });
    const html = body(ready(HELM, off));
    const web = rowOf(html, "웹 검색");
    expect(web).toContain('aria-checked="false"');
    expect(web).not.toContain('disabled=""');
    expect(textOf(web)).toContain("이 대화에서 꺼짐");
    expect(textOf(rowOf(html, "Helm"))).not.toContain("이 대화에서 꺼짐");
    expect(countOn(html)).toBe(1);
  });

  test("S3 전역에서 꺼진 플러그인은 스위치가 잠기고 크래프트에서 켜라는 한 줄을 보인다", () => {
    const off = entry("web", { displayName: "웹 검색", status: "disabled" });
    const web = rowOf(body(ready(off)), "웹 검색");
    expect(web).toContain('aria-checked="false"');
    expect(web).toContain('disabled=""');
    expect(textOf(web)).toContain("전역에서 꺼져 있어요. 크래프트에서 켜면 쓸 수 있어요.");
    expect(textOf(web)).not.toContain("이 대화에서 꺼짐");
  });

  test("S4 턴이 진행 중이면(경계를 기다림) 스위치는 잠기고 '이번 단계가 끝나면 적용돼요' 배지를 단다", () => {
    const disabling = entry("web", { displayName: "웹 검색", registration: "disabling" });
    const off = rowOf(body(ready(disabling)), "웹 검색");
    expect(off).toContain('aria-checked="false"');
    expect(off).toContain('disabled=""');
    expect(textOf(off)).toContain("이번 단계가 끝나면 적용돼요");

    const enabling = entry("web", { displayName: "웹 검색", registration: "enabling" });
    const on = rowOf(body(ready(enabling)), "웹 검색");
    expect(on).toContain('aria-checked="true"');
    expect(textOf(on)).toContain("이번 단계가 끝나면 적용돼요");
  });

  test("쓰는 중인 행은 목표 값으로 잠기고, 배지를 달지 않는다", () => {
    const html = body(ready(WEB), { showing: { web: false } });
    const web = rowOf(html, "웹 검색");
    expect(web).toContain('aria-checked="false"');
    expect(web).toContain('disabled=""');
    expect(textOf(web)).not.toContain("이 대화에서 꺼짐");
  });

  test("면제 tier 행은 그리지 않고, 남은 행이 없으면 빈 글 한 줄을 보인다", () => {
    const html = body(ready(CORE));
    expect(html).not.toContain(LABEL("core-loop"));
    expect(textOf(html)).toContain(t("desktop.plugin.thread.empty"));
  });

  test("안전 모드와 관리 정책으로 잠긴 행은 각자 이유 한 줄을 보인다", () => {
    const safe = entry("acme", { displayName: "Acme", safeModeExcluded: "안전 모드" });
    const managed = entry("policy", { displayName: "Policy", enabledSource: "managed" });
    const html = body(ready(safe, managed));
    expect(textOf(rowOf(html, "Acme"))).toContain(t("desktop.workbench.lock.safeMode"));
    expect(textOf(rowOf(html, "Policy"))).toContain(t("desktop.workbench.lock.managed"));
    expect(rowOf(html, "Policy")).toContain('disabled=""');
  });
});

describe("이 대화에서 끄기 구역: 대화 없음, 읽는 중, 오류, 끊김", () => {
  test("S6 열린 대화가 없으면 한 줄만 보이고 스위치는 없다", () => {
    const html = body({ kind: "idle" }, { threadOpen: false });
    expect(textOf(html)).toContain("열린 대화가 없어요. 대화를 열면 이 대화에서 끌 수 있어요.");
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

/** 쓰기 시험의 가짜 항구: 명령 결과, 다시 읽기 결과, 보낸 요청과 토스트와 쓰는 중 그림을 모은다 */
function portFor(
  toggle: () => Promise<Result<null, CommandError>>,
  after: ThreadListLoad,
): {
  readonly port: ThreadSwitchPort;
  readonly requests: ThreadToggleRequest[];
  readonly notes: ToastOptions[];
  readonly showing: [string, boolean | null][];
  readonly reads: number[];
} {
  const requests: ThreadToggleRequest[] = [];
  const notes: ToastOptions[] = [];
  const showing: [string, boolean | null][] = [];
  const reads: number[] = [];
  const port: ThreadSwitchPort = {
    commands: {
      toggleForThread: (request) => {
        requests.push(request);
        return toggle();
      },
    },
    reload: () => {
      reads.push(reads.length + 1);
      return Promise.resolve(after);
    },
    showing: (name, target) => {
      showing.push([name, target]);
    },
    notify: (options) => {
      notes.push(options);
    },
  };
  return { port, requests, notes, showing, reads };
}

const saved = (): Promise<Result<null, CommandError>> => Promise.resolve(ok(null));
const failed = (): Promise<Result<null, CommandError>> => Promise.resolve(err({ kind: "failed" }));

/** 다음 턴이 끝날 때까지 기다리는 한 바퀴. 명령과 다시 읽기는 모두 바로 풀린다 */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("이 대화에서 끄기: 클릭과 쓰기", () => {
  test("스위치를 누르면 settings.set이 범위 launch와 대화 id를 싣고 값만 바뀐 요청으로 나간다", async () => {
    const clicks: [string, boolean][] = [];
    const tree = ThreadSwitchesBody({
      threadOpen: true,
      link: "live",
      list: ready(WEB),
      showing: {},
      onToggle: (clicked, target) => {
        clicks.push([clicked.name, target]);
      },
    });
    const sw = switchOf(tree, LABEL("웹 검색"));
    expect(sw).toBeDefined();
    sw?.onCheckedChange?.(false);
    expect(clicks).toEqual([["web", false]]);

    const { port, requests, notes, showing, reads } = portFor(saved, ready(WEB));
    await writeThreadSwitch(port, THREAD, WEB, false);
    expect(requests).toEqual([
      { key: "ext.web.enabled", value: false, scope: "launch", threadId: THREAD },
    ]);
    expect(showing).toEqual([
      ["web", false],
      ["web", null],
    ]);
    expect(reads).toEqual([1]);
    expect(notes.map(({ tone, title }) => ({ tone, title }))).toEqual([
      { tone: "success", title: t("desktop.plugin.thread.done.off") },
    ]);
    expect(notes.map(({ description }) => description)).toEqual(["다음 턴부터 적용돼요"]);
  });

  test("다시 켜는 요청은 값 true다", async () => {
    const { port, requests } = portFor(saved, ready(WEB));
    await writeThreadSwitch(port, THREAD, WEB, true);
    expect(requests).toEqual([
      { key: "ext.web.enabled", value: true, scope: "launch", threadId: THREAD },
    ]);
  });

  test("적용 대기가 남으면 성공 토스트는 띄우지 않는다", async () => {
    const waiting = entry("web", { displayName: "웹 검색", registration: "disabling" });
    const { port, notes } = portFor(saved, ready(waiting));
    await writeThreadSwitch(port, THREAD, WEB, false);
    expect(notes).toEqual([]);
  });

  test("S5 저장 실패: 다시 읽어 원래 값으로 돌아가고, 다시 시도 토스트를 띄운다", async () => {
    const { port, requests, notes, showing, reads } = portFor(failed, ready(WEB));
    await writeThreadSwitch(port, THREAD, WEB, false);
    expect(reads).toEqual([1]);
    expect(showing).toEqual([
      ["web", false],
      ["web", null],
    ]);
    expect(notes.map(({ tone, title, actionLabel }) => ({ tone, title, actionLabel }))).toEqual([
      {
        tone: "danger",
        title: t("desktop.plugin.thread.failed"),
        actionLabel: t("desktop.plugin.thread.retry"),
      },
    ]);
    expect(requests).toHaveLength(1);
  });

  test("다시 시도 단추는 같은 요청을 한 번 더 보낸다", async () => {
    const { port, requests, notes } = portFor(failed, ready(WEB));
    await writeThreadSwitch(port, THREAD, WEB, false);
    notes[0]?.onAction?.();
    await settle();
    expect(requests).toEqual([
      { key: "ext.web.enabled", value: false, scope: "launch", threadId: THREAD },
      { key: "ext.web.enabled", value: false, scope: "launch", threadId: THREAD },
    ]);
  });

  test("잠긴 행은 명령을 보내지 않고 아무것도 띄우지 않는다", async () => {
    const off = entry("web", { displayName: "웹 검색", status: "disabled" });
    const { port, requests, notes, showing } = portFor(saved, ready(off));
    await writeThreadSwitch(port, THREAD, off, true);
    expect(requests).toEqual([]);
    expect(notes).toEqual([]);
    expect(showing).toEqual([]);
  });
});
