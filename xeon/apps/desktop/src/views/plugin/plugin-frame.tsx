import { PuzzleArt } from "../illustrations/index.tsx";
import { Button, EmptyState, Skeleton } from "@caustic/react";
import { t } from "@fresnel/client/i18n";
import {
  attachFrame,
  FRAME_SANDBOX,
  type BridgeBackend,
  type BridgePolicyContext,
  type BridgePort,
  type ConfirmAnswer,
  type ConfirmRequest,
  type FrameHost,
  type ThemePush,
} from "@fresnel/client/views/app";
import type { LedgerFailure, ScreenLedger } from "@fresnel/client/views/ledger";
import type { Clock, Scheduler } from "@fresnel/contracts";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { InfoTip } from "../craft/info-tip.tsx";
import { frameReasonText } from "./frame-reason.ts";

// Plugin App 프레임 한 칸(ADR-0021 §3.4.2, §3.6.2). iframe 하나를 그리고 `attachFrame`으로 그 수명을 맡는다.
// sandbox 값은 `attachFrame`이 건다(`allow-scripts`만, `allow-same-origin` 없음). 이 파일은 같은 상수 `FRAME_SANDBOX`를 JSX에 주기만 한다.
// 장부가 화면을 끄거나 프레임이 닫히면 iframe 대신 자리 표시를 그리고, "다시 켜기"로 장부를 비우고 새로 붙인다.

/** 프레임 높이 하한과 상한(px). 프레임이 알린 높이는 이 사이의 정수로 줄인다 */
const FRAME_HEIGHT_MIN = 80;
const FRAME_HEIGHT_MAX = 800;
const FRAME_HEIGHT_DEFAULT = 320;

/**
 * 프레임이 알린 높이를 80~800px의 정수로 줄인다. 유한하지 않은 값(NaN, 무한대)은 `undefined`다.
 * 호출자는 `undefined`이면 높이를 바꾸지 않는다.
 */
export function clampFrameHeight(height: number): number | undefined {
  if (!Number.isFinite(height)) return undefined;
  return Math.min(FRAME_HEIGHT_MAX, Math.max(FRAME_HEIGHT_MIN, Math.round(height)));
}

export interface PluginFrameProps {
  /** 화면 키 `<확장이름>/<화면 id>`. 장부가 이 키로 센다 */
  readonly screenKey: string;
  /** `buildAppUrl`이 만든 프레임 주소. `#n=<nonce>` 조각을 포함한다 */
  readonly url: string;
  /** 주소 조각으로 준 넘겨받기 nonce. `ready`가 같은 값을 되돌려야 포트를 넘긴다 */
  readonly nonce: string;
  /** 매니페스트 `app.bridge`. `ready`가 같은 값을 말해야 한다 */
  readonly declaredBridge: string;
  readonly ledger: ScreenLedger;
  /** 요청마다 읽는 판정 맥락 */
  readonly context: () => BridgePolicyContext;
  /** 이 프레임의 백엔드를 만든다. 크기 조절 요청은 `resize`로 돌아온다 */
  readonly makeBackend: (resize: (height: number) => void) => BridgeBackend;
  /** `call`·`command` 확인 줄의 답. 확인 줄 큐의 `request`를 주면 된다 */
  readonly confirm: (request: ConfirmRequest) => Promise<ConfirmAnswer>;
  /** 답이 없는 확인 요청을 줄에서 뺀다(시간 초과, 프레임 닫힘). 확인 줄 큐의 `cancel`을 주면 된다 */
  readonly cancelConfirm: (request: ConfirmRequest) => void;
  /** 테마. 이 함수의 identity가 바뀌면 새 테마를 보낸다 */
  readonly theme: () => ThemePush;
  /** iframe의 `title` 속성 */
  readonly title: string;
  /** 프레임이 닫혔을 때 부른다. 이유는 장부 실패 이름이거나, 언마운트로 거두었으면 `disposed`다 */
  readonly onClosed: (reason: LedgerFailure | "disposed") => void;
}

/** 브라우저 시계와 타이머. 프레임 수명 안의 시간만 잰다 */
export const browserScheduler: Scheduler = {
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (handle) => {
    window.clearTimeout(handle);
  },
};
export const browserClock: Clock = { now: () => Date.now() };

/** `MessagePort`를 다리 포트 구조로 바꾼다. 핸들러는 한 번에 하나이고, 널을 주면 떼어 낸다 */
function bridgePortOf(port: MessagePort): BridgePort {
  let listener: ((event: MessageEvent<unknown>) => void) | undefined;
  return {
    postMessage(message) {
      port.postMessage(message);
    },
    setHandler(handler) {
      if (listener !== undefined) port.removeEventListener("message", listener);
      listener = undefined;
      if (handler === undefined) return;
      listener = (event: MessageEvent<unknown>) => {
        handler(event.data);
      };
      port.addEventListener("message", listener);
      // addEventListener로 받을 때는 포트를 직접 열어야 메시지가 온다
      port.start();
    },
    close() {
      port.close();
    },
  };
}

function createFrameChannel(): { readonly port1: BridgePort; readonly port2: MessagePort } {
  const channel = new MessageChannel();
  return { port1: bridgePortOf(channel.port1), port2: channel.port2 };
}

export function PluginFrame(props: PluginFrameProps): ReactNode {
  const { screenKey, ledger, onClosed, title } = props;
  // 프레임이 스스로 닫힌 이유. 장부가 끈 화면의 이유는 장부에서 읽는다
  const [closed, setClosed] = useState<LedgerFailure | null>(null);
  // 다시 켜기마다 올린다. 새 iframe 요소를 만들어 이전 문서의 흔적을 남기지 않는다
  const [generation, setGeneration] = useState(0);

  // 이 화면이 장부에서 꺼졌는가. 스냅샷은 불리언이라 다시 읽어도 같은 값이면 다시 그리지 않는다
  const subscribeDisabled = useCallback(
    (listener: () => void) =>
      ledger.subscribe((key) => {
        if (key === screenKey) listener();
      }),
    [ledger, screenKey],
  );
  const readDisabled = useCallback(
    () => ledger.stateOf(screenKey).state === "view_disabled",
    [ledger, screenKey],
  );
  const disabled = useSyncExternalStore(subscribeDisabled, readDisabled, readDisabled);

  const handleClosed = (reason: LedgerFailure | "disposed"): void => {
    // 언마운트나 주소 바뀜으로 거두는 것(disposed)은 자리 표시를 띄우지 않는다
    if (reason !== "disposed") setClosed(reason);
    onClosed(reason);
  };

  if (disabled || closed !== null) {
    const state = ledger.stateOf(screenKey);
    const reason = closed ?? (state.state === "view_disabled" ? state.last : null);
    return (
      <FrameBox label={title}>
        <FramePlaceholder
          reason={reason}
          onReenable={() => {
            ledger.reenable(screenKey);
            setClosed(null);
            setGeneration((current) => current + 1);
          }}
        />
      </FrameBox>
    );
  }
  return <PluginFrameMount key={generation} {...props} onClosed={handleClosed} />;
}

/** 프레임 상자: 셸이 긋는 경계 하나(안쪽 1px 그림자, 여백 없음). 안쪽 여백은 플러그인 몫이라 셸은 주지 않는다 */
function FrameBox(props: { readonly label: string; readonly children: ReactNode }): ReactNode {
  return (
    <section
      role="region"
      aria-label={props.label}
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border-default"
    >
      {props.children}
    </section>
  );
}

/** 자리 표시. 장부가 끈 화면이나 닫힌 프레임을 상자 안 가운데에 대신한다 */
function FramePlaceholder(props: {
  readonly reason: LedgerFailure | null;
  readonly onReenable: () => void;
}): ReactNode {
  const text = frameReasonText(props.reason);
  return (
    <div className="grid flex-1 place-items-center px-3 py-6">
      <EmptyState
        media={<PuzzleArt />}
        size="sm"
        surface="none"
        title={
          text.info === null ? (
            text.line
          ) : (
            <span className="inline-flex items-center gap-1">
              {text.line}
              <InfoTip text={text.info} />
            </span>
          )
        }
        actions={
          <Button size="xs" variant="outline" onClick={props.onReenable}>
            {t("desktop.plugin.frame.reenable")}
          </Button>
        }
      />
    </div>
  );
}

/** ready를 기다리는 동안 상자를 덮는 Skeleton과 한 줄 글. ready를 받으면 걷힌다 */
function FrameLoading(props: { readonly line: string }): ReactNode {
  return (
    <div aria-busy="true" className="absolute inset-0 grid content-start gap-4 bg-surface-base p-4">
      <p role="status" className="m-0 text-ui-xs text-text-tertiary">
        {props.line}
      </p>
      <div className="grid grid-cols-3 gap-4">
        {[0, 1, 2].map((column) => (
          <div key={column} className="grid content-start gap-2">
            <Skeleton height={14} width="40%" />
            <Skeleton height={56} />
            <Skeleton height={56} />
            {column === 0 && <Skeleton height={56} />}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * iframe 하나와 그 수명. 부모가 다시 그려도 붙인 프레임은 그대로이고, 주소나 장부가 바뀔 때만 다시 붙인다.
 * 콜백 props는 `latest`로 읽는다. 그래서 콜백 identity가 바뀌어도 프레임을 내리지 않는다.
 */
function PluginFrameMount(props: PluginFrameProps): ReactNode {
  const { screenKey, url, nonce, declaredBridge, ledger, theme, title } = props;
  const latest = useRef(props);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const frameRef = useRef<FrameHost | undefined>(undefined);
  const [height, setHeight] = useState(FRAME_HEIGHT_DEFAULT);
  // `initialPushes`는 `ready`를 받은 순간에만 불린다. 그때 준비가 끝난 것으로 본다
  const [ready, setReady] = useState(false);

  useEffect(() => {
    latest.current = props;
  });

  useEffect(() => {
    frameRef.current?.push("theme", theme());
  }, [theme]);

  useEffect(() => {
    const element = iframeRef.current;
    if (element === null) return undefined;
    const applyResize = (requested: number): void => {
      const next = clampFrameHeight(requested);
      if (next !== undefined) setHeight(next);
    };
    setReady(false);
    const host = attachFrame<MessagePort>({
      element,
      messages: window,
      url,
      declaredBridge,
      readyNonce: nonce,
      createChannel: createFrameChannel,
      scheduler: browserScheduler,
      ledger,
      screenKey,
      bridge: {
        context: () => latest.current.context(),
        backend: latest.current.makeBackend(applyResize),
        clock: browserClock,
        confirm: (request) => latest.current.confirm(request),
        cancelConfirm: (request) => {
          latest.current.cancelConfirm(request);
        },
      },
      initialPushes: () => {
        setReady(true);
        return [{ name: "theme", value: latest.current.theme() }];
      },
      onClosed: (reason) => {
        latest.current.onClosed(reason);
      },
    });
    frameRef.current = host;
    return () => {
      frameRef.current = undefined;
      host.dispose();
    };
  }, [screenKey, url, nonce, declaredBridge, ledger]);

  return (
    <FrameBox label={title}>
      {/* sandbox 값은 attachFrame(applyFrameAttributes)이 같은 상수로 다시 건다. 여기서는 그 상수만 준다. 넓히는 토큰은 없다 */}
      <iframe
        ref={iframeRef}
        title={title}
        sandbox={FRAME_SANDBOX}
        className="w-full border-0"
        style={{ height }}
      />
      {ready ? null : <FrameLoading line={t("desktop.plugin.frame.loading")} />}
    </FrameBox>
  );
}
