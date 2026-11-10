// `/shell` 연결 하나의 세션(L4.remote.spec §5.2, §7). 텍스트 프레임을 `ClientFrame`으로 좁히고,
// `invoke`는 이 탭의 레지스트리로 보내 답을 `reply`로 돌려준다. 모양이 틀리면 연결을 닫는다.
import { attempt, detach } from "@fresnel/contracts";
import { isRecord, ownField } from "../../main/lib/narrow.ts";
import type { TabSession, TabSessionFactory, TabSessionInput } from "./ports.ts";
import {
  decodeFrame,
  encodeFrame,
  MAX_SHELL_FRAME_CHARS,
  type ClientFrame,
  type ServerFrame,
} from "./protocol.ts";
import { createWebContext, type WebContextOptions } from "./web-context.ts";

/** 탭 세션을 만드는 값. `send`와 `deviceId`는 세션이 채운다 */
export type TabSessionOptions = Omit<WebContextOptions, "send" | "deviceId" | "tabId">;

type InvokeFrame = Extract<ClientFrame, { readonly t: "invoke" }>;

/** 서버가 부르는 면. 탭마다 `open`이 세션 하나를 만든다 */
export function createTabSessionFactory(options: TabSessionOptions): TabSessionFactory {
  return {
    open(input) {
      return openTab(options, input);
    },
  };
}

function openTab(options: TabSessionOptions, input: TabSessionInput): TabSession {
  const state = { closed: false };
  const log = options.log;

  const send = (frame: ServerFrame): void => {
    if (!state.closed) input.send(encodeFrame(frame));
  };
  const web = createWebContext({
    ...options,
    send,
    deviceId: input.deviceId,
    tabId: crypto.randomUUID(),
  });
  log.line(`web session opened device=${input.deviceId}`);

  /** 세션을 끝낸다. 여러 번 불러도 정리는 한 번만 돈다 */
  const shutDown = (): void => {
    if (state.closed) return;
    state.closed = true;
    log.line(`web session closed device=${input.deviceId}`);
    detach(web.close(), () => {
      log.line("web session: cleanup did not finish");
    });
  };

  /** 프로토콜 위반이다. 연결을 닫고 세션을 끝낸다. 프레임 내용은 로그에 남기지 않는다 */
  const refuse = (code: number, reason: string): void => {
    log.line(`web session refused a frame (${reason}) device=${input.deviceId}`);
    input.closeConnection(code, reason);
    shutDown();
  };

  /**
   * `invoke`에 답한다. `dispatch`를 이 함수가 불린 바로 그 순간에 부른다(`async` 함수는 첫 `await`까지 동기로 돈다).
   * 그래서 같은 탭의 `engine_write`가 받은 순서대로 감독자의 쓰기 대기열에 들어간다. 답은 끝난 순서대로 나간다(데스크톱과 같다).
   */
  const answer = async (frame: InvokeFrame): Promise<void> => {
    const reply = await web.dispatch(frame.cmd, frame.args);
    if (reply.ok) {
      send({ t: "reply", id: frame.id, ok: true, value: reply.value });
    } else {
      send({ t: "reply", id: frame.id, ok: false, error: reply.error });
    }
  };

  return {
    receive(text) {
      if (state.closed) return;
      if (text.length > MAX_SHELL_FRAME_CHARS) {
        refuse(1009, "too-large");
        return;
      }
      // 해석 오류의 문장에는 프레임 글자가 들어갈 수 있다(시크릿 값 포함). 그래서 문장은 버리고 코드만 쓴다
      const decoded = attempt(() => decodeFrame(text));
      if (!decoded.ok) {
        refuse(1008, "bad-frame");
        return;
      }
      const frame = clientFrameOf(decoded.value);
      if (frame === null) {
        refuse(1008, "bad-frame");
        return;
      }
      if (frame.t === "close-channel") {
        web.closeChannel(frame.id);
        return;
      }
      detach(answer(frame), () => {
        log.line("web session: answering a command failed");
        input.closeConnection(1011, "internal");
        shutDown();
      });
    },
    close() {
      shutDown();
    },
  };
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * 해석된 JSON 값이 `ClientFrame`의 모양인지 본다. 선언된 두 종류만 받고, 나머지 속성은 무시한다.
 * `args`는 어떤 값이든 받는다(명령마다 검사한다). 모양이 틀리면 null이다.
 */
function clientFrameOf(value: unknown): ClientFrame | null {
  if (!isRecord(value)) return null;
  const id = ownField(value, "id");
  if (!isCount(id)) return null;
  const tag = ownField(value, "t");
  if (tag === "close-channel") return { t: "close-channel", id };
  if (tag === "invoke") {
    const cmd = ownField(value, "cmd");
    if (typeof cmd !== "string") return null;
    return { t: "invoke", id, cmd, args: ownField(value, "args") };
  }
  return null;
}
