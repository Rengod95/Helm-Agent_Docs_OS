// 대화 모션 테이프(시험 전용, 제품 코드가 import하지 않는다. dzM2 시안 §12).
// 살아 있는 엔진 거울(시험 하네스)에 사건을 차례로 넣어 실제 대화 화면(가상 목록 포함)의 들어옴·상태 바뀜·스트리밍·확정·압축을 재생한다.
// 촬영 스크립트(_notes/tools/dzM2/)가 `window.tape`의 함수를 불러 장면을 만들고 프레임을 찍는다.
// 지금 띠·대기 칩·beam·목록 FLIP은 거울 배선이 큰 부품이라 같은 표시 부품을 장면 값으로 직접 돌린다.
import { setActiveLocale } from "@fresnel/client/i18n";
import { detach, ok, rethrow } from "@fresnel/contracts";
import type {
  ItemId,
  ItemRecord,
  JsonObject,
  ThreadId,
  TurnId,
} from "@fresnel/contracts/conversation";
import type { EventWire } from "@fresnel/contracts/wire";
import { useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { highlightCode } from "../../../src/lib/highlight.ts";
import { Presence, useFlipList } from "../../../src/lib/motion-presets.tsx";
import { decodeDurable } from "../../../src/state/engine/decode.ts";
import type { DurableFact, VolatileFact } from "../../../src/state/engine/input.ts";
import { createShellStore, ShellStoreContext } from "../../../src/state/shell/index.ts";
import { createUiStore } from "../../../src/state/ui/store.ts";
import { BeamScope, type BeamState } from "../../../src/views/effects/beam.tsx";
import {
  MessageActionsContext,
  type MessageActionsPort,
} from "../../../src/views/convo/message-actions.tsx";
import { NowStripView } from "../../../src/views/now/now-strip.tsx";
import type { NowView } from "../../../src/views/now/now-model.ts";
import { Providers } from "../../../src/views/providers.tsx";
import { createPluginUiRuntime } from "../../../src/plugin-ui/runtime.ts";
import { createConfirmQueue } from "../../../src/views/plugin/confirm-host.tsx";
import {
  PluginUiProvider,
  type PluginUiContextValue,
} from "../../../src/views/plugin/plugin-context.tsx";
import { extGetOf } from "../../plugin-ui/support.ts";
import { fakeConnection } from "../../state/fake-connection.ts";
import { QueuedInputs } from "../../../src/views/queued-inputs.tsx";
import { Transcript } from "../../../src/views/transcript.tsx";
import { fakeCommands } from "../../views/fake-commands.ts";
import { evt, itm, openedHarness, prt, summary, thr, trn } from "../../state/helpers.ts";

setActiveLocale("ko");
const params = new URLSearchParams(window.location.search);
document.documentElement.dataset["theme"] = params.get("theme") === "light" ? "light" : "dark";
if (params.get("motion") === "reduce") document.documentElement.dataset["motion"] = "reduce";
// 오로라 자리 견주기(dzE 시안 §2.5): ?aurora=strip|both|off
const auroraParam = params.get("aurora");
if (auroraParam !== null) document.documentElement.dataset["fxAurora"] = auroraParam;

const T: ThreadId = thr(1);
const h = openedHarness(5, T);
h.store.ingest({ type: "threads", threads: [summary(T, { title: "모션 테이프" })] });
h.store.ingest({ type: "engine", state: { kind: "running", source: "sidecar", pid: 1 } });
h.store.flush();

let seq = 5;
let n = 0;
let at = Date.parse("2026-11-12T05:00:00.000Z");
const iso = (): string => new Date((at += 1000)).toISOString();

function durable(make: (seq: number) => DurableFact): void {
  const from = seq;
  seq += 1;
  h.store.ingest({ type: "batch", sub: "s1", from, to: seq, caughtUp: true, facts: [make(seq)] });
  h.store.flush();
}

function volatile(make: (n: number) => VolatileFact): void {
  n += 1;
  h.store.ingest({ type: "chunk", fact: make(n) });
  h.store.flush();
}

type Block =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "thinking"; readonly thinking: string }
  | {
      readonly type: "toolCall";
      readonly id: string;
      readonly name: string;
      readonly arguments: JsonObject;
    };

function assistantItem(
  id: ItemId,
  content: readonly Block[],
  partIds: readonly string[],
): ItemRecord {
  return {
    itemId: id,
    status: "completed",
    kind: "assistant",
    partIds: partIds.map((p, i) => (p === "" ? prt(9000 + i) : prt(Number(p)))),
    message: {
      role: "assistant",
      content: [...content],
      api: "anthropic-messages",
      provider: "anthropic",
      model: "claude-sonnet-5-5",
      usage: {
        input: 1200,
        output: 300,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 1500,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: at,
    },
  };
}

let turn: TurnId | null = null;
let turnN = 0;

/** 테이프 조작. 촬영 스크립트가 부른다 */
const tape = {
  /** 사용자 말 하나와 턴 시작 */
  user(itemN: number, text: string): void {
    const id = itm(itemN);
    durable((s) => ({
      type: "item.recorded",
      seq: s,
      eventId: evt(s),
      threadId: T,
      turnId: null,
      at: iso(),
      item: {
        itemId: id,
        status: "completed",
        kind: "user",
        message: { role: "user", content: text, timestamp: at },
        requestId: null,
      },
    }));
    turnN += 1;
    turn = trn(turnN);
    const started = turn;
    durable((s) => ({
      type: "turn.started",
      seq: s,
      eventId: evt(s),
      threadId: T,
      turnId: started,
      at: iso(),
      start: { origin: "user", scopeId: null, requestId: null, inputItemIds: [id], invoked: [] },
    }));
  },
  /** 진행 중 item 시작(답이면 assistant, 도구 실행이면 toolCall) */
  start(
    itemN: number,
    kind: "assistant" | "toolCall",
    toolCallId?: string,
    toolName?: string,
  ): void {
    volatile((k) => ({
      n: k,
      type: "item.started",
      threadId: T,
      turnId: turn,
      payload: {
        itemId: itm(itemN),
        kind,
        toolCallId: toolCallId ?? null,
        toolName: toolName ?? null,
      },
    }));
  },
  /** 파트 조각. partN은 파트 id 번호(확정 item의 partIds와 맞춘다) */
  delta(
    itemN: number,
    partN: number,
    contentIndex: number,
    kind: "text" | "thinking" | "toolCall",
    text: string,
  ): void {
    volatile((k) => ({
      n: k,
      type: "item.updated",
      threadId: T,
      turnId: turn,
      payload: {
        itemId: itm(itemN),
        update: {
          kind: "part_delta",
          delta: {
            partId: prt(partN),
            itemId: itm(itemN),
            contentIndex,
            kind,
            phase: "delta",
            delta: text,
          },
        },
      },
    }));
  },
  /** 답 item 확정. partIds는 파트 번호 글(스트리밍에 쓴 번호) */
  recordAssistant(itemN: number, content: readonly Block[], partIds: readonly string[]): void {
    const item = assistantItem(itm(itemN), content, partIds);
    durable((s) => ({
      type: "item.recorded",
      seq: s,
      eventId: evt(s),
      threadId: T,
      turnId: turn,
      at: iso(),
      item,
    }));
  },
  /** 도구 결과 확정 */
  result(itemN: number, callId: string, toolName: string, text: string, isError: boolean): void {
    durable((s) => ({
      type: "item.recorded",
      seq: s,
      eventId: evt(s),
      threadId: T,
      turnId: turn,
      at: iso(),
      item: {
        itemId: itm(itemN),
        status: isError ? "failed" : "completed",
        kind: "toolResult",
        effectId: null,
        message: {
          role: "toolResult",
          toolCallId: callId,
          toolName,
          content: [{ type: "text", text }],
          isError,
          timestamp: at,
        },
      },
    }));
  },
  turnDone(): void {
    const done = turn;
    durable((s) => ({
      type: "turn.completed",
      seq: s,
      eventId: evt(s),
      threadId: T,
      turnId: done,
      at: iso(),
      payload: { status: "completed", stepCount: 2, usage: null, error: null },
    }));
  },
  compact(): void {
    durable((s) => ({
      type: "thread.compacted",
      seq: s,
      eventId: evt(s),
      threadId: T,
      turnId: null,
      at: iso(),
      compaction: {
        summary: "앞의 대화를 요약했습니다. 로그인 검증 규칙을 한곳에 모았고 시험을 더했습니다.",
        tokensBefore: 182000,
        tokensAfter: 24000,
        reason: "threshold",
      },
    }));
  },
  queue(text: string): void {
    durable((s) => decodeDurable(queuedWire(s, text)));
  },
  withdraw(inputSeq: number): void {
    durable((s) =>
      decodeDurable(wire(s, "input.withdrawn", { inputId: evt(inputSeq), reason: "user" })),
    );
  },
  /** 지금까지 넣은 마지막 seq(대기 입력 철회에 쓴다) */
  seq(): number {
    return seq;
  },
  /** 거울의 대화 상태(진단용) */
  threadStatus(): string {
    return h.store.read.getState().threads.byId[T]?.status ?? "none";
  },
};

function wire(s: number, kind: EventWire["kind"], payload: unknown): EventWire {
  return {
    id: evt(s),
    kind,
    version: 1,
    durable: true,
    seq: s,
    parentId: null,
    threadId: T,
    turnId: null,
    stepId: null,
    recordedAt: new Date(at).toISOString(),
    causationId: null,
    correlationId: null,
    payload,
    redactions: [],
  };
}

function queuedWire(s: number, text: string): EventWire {
  return wire(s, "input.queued", {
    mode: "followUp",
    item: { kind: "user", content: text },
    requestId: `req-${String(s)}`,
    source: { type: "user", via: "interactive" },
  });
}

// ── 장면 값으로 돌리는 부품(지금 띠, beam, 목록 FLIP) ───────────────────────────────

type Scene = {
  now: NowView | null;
  nowOpen: boolean;
  beam: BeamState;
  /** 입력창 높이(px). 자라는 입력창에서 beam이 다시 재는지 본다(dzE) */
  composerH: number;
  list: readonly string[];
};

const scene: { set: ((next: Partial<Scene>) => void) | null } = { set: null };

function Composerish(props: { readonly beam: BeamState; readonly height: number }): ReactNode {
  return (
    <BeamScope target=".composer-box" state={props.beam} className="flex flex-none flex-col">
      <div className="mx-auto w-full max-w-184 px-3 pb-3">
        {/* 실제 입력창(composer.tsx)과 같은 반경 클래스: Chromium에서 caustic이 squircle을 준다 */}
        <div
          className="composer-box grid rounded-[calc(var(--radius-2xl)+4px)] border border-border-default bg-surface-raised px-3 pt-2.5 text-ui text-text-tertiary"
          style={{ height: props.height }}
          data-tape-composer=""
        >
          메시지를 입력하세요
        </div>
      </div>
    </BeamScope>
  );
}

function FlipDemo(props: { readonly list: readonly string[] }): ReactNode {
  const box = useRef<HTMLUListElement | null>(null);
  useFlipList(box, props.list.join(","), "");
  return (
    <ul ref={box} data-tape-flip="" className="m-0 grid list-none gap-1 p-2">
      {props.list.map((name) => (
        <li
          key={name}
          data-flip-key={name}
          className="flex h-8 items-center rounded-md bg-neutral-well px-2 text-ui text-text-primary"
        >
          {name}
        </li>
      ))}
    </ul>
  );
}

function Stage(): ReactNode {
  const [state, setState] = useState<Scene>({
    now: null,
    nowOpen: false,
    beam: "off",
    composerH: 69,
    list: [],
  });
  scene.set = (next) => {
    setState((prev) => ({ ...prev, ...next }));
  };
  return (
    <div className="flex h-dvh">
      <div className="flex min-w-0 flex-1 flex-col bg-surface-base">
        <Transcript />
        <div className="mx-auto grid w-full max-w-184 flex-none">
          <Presence show={state.now !== null} variant="band" initial={false}>
            {state.now === null ? null : (
              <NowStripView
                view={state.now}
                open={state.nowOpen}
                onOpenChange={(open) => {
                  setState((prev) => ({ ...prev, nowOpen: open }));
                }}
              />
            )}
          </Presence>
          <div className="px-3">
            <QueuedInputs
              threadId={T}
              disabledReason={null}
              steerable={() => false}
              onSteerNow={() => Promise.resolve({ status: "idle" })}
            />
          </div>
        </div>
        <Composerish beam={state.beam} height={state.composerH} />
      </div>
      {state.list.length === 0 ? null : (
        <aside className="w-56 flex-none border-l border-border-subtle">
          <FlipDemo list={state.list} />
        </aside>
      )}
    </div>
  );
}

const noAction: MessageActionsPort = {
  forkAt: () => Promise.resolve(ok(null)),
  rewindTo: () => Promise.resolve(ok(null)),
  regenerate: () => Promise.resolve(ok(null)),
};

/** 촬영 스크립트가 쓰는 창 전역 */
declare global {
  interface Window {
    tape: typeof tape & { scene: (next: Partial<Scene>) => void };
  }
}

/** 확장 카드가 없는 플러그인 문맥(출처 칩·확장 카드 부품이 문맥을 읽는다) */
async function pluginUi(): Promise<PluginUiContextValue> {
  const fake = fakeConnection({
    "ext.ui.list": () => Promise.resolve({ items: [] }),
    "ext.list": () => Promise.resolve({ extensions: [] }),
    "ext.get": () => Promise.resolve(extGetOf()),
    "settings.get": () => Promise.resolve({ settings: [] }),
  });
  const runtime = createPluginUiRuntime({
    withConnection: async (run) => ok(await run(fake.connection)),
    appRootsInvoke: undefined,
    framesSupported: false,
  });
  await runtime.refresh();
  return { runtime, confirm: createConfirmQueue(), openExternal: () => Promise.resolve() };
}

async function start(): Promise<void> {
  const plugin = await pluginUi();
  await Promise.all([highlightCode("x", "ts"), highlightCode("x", "bash")]);
  const host = document.getElementById("root");
  if (host === null) return;
  window.tape = {
    ...tape,
    scene: (next) => {
      scene.set?.(next);
    },
  };
  createRoot(host).render(
    <ShellStoreContext value={createShellStore(1440)}>
      <Providers engine={h.store.read} ui={createUiStore().read} commands={fakeCommands()}>
        <PluginUiProvider value={plugin}>
          <MessageActionsContext value={noAction}>
            <Stage />
          </MessageActionsContext>
        </PluginUiProvider>
      </Providers>
    </ShellStoreContext>,
  );
  document.body.dataset["ready"] = "1";
}

detach(start(), rethrow);
