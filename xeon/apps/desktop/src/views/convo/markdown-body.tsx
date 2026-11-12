import { IconButton } from "@caustic/react";
import { Copy } from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import {
  createContext,
  memo,
  useContext,
  useEffect,
  useState,
  type NamedExoticComponent,
  type ReactNode,
} from "react";
import type { Components } from "react-markdown";
import { highlightCode, type HighlightedLines } from "../../lib/highlight.ts";
import { renderMarkdown } from "../../lib/markdown.tsx";
import { renderStreamingMarkdown } from "../../lib/markdown-stream.ts";
import { SwapFade } from "../../lib/motion-presets.tsx";
import { DrawnCheck } from "../effects/drawn-check.tsx";
import { useOpenSource } from "./open-source.ts";

/** 이 본문이 스트리밍 중인지. 부품 함수를 렌더마다 새로 만들지 않으려고 문맥으로 넘긴다 */
const StreamingContext = createContext(false);

// 답 본문(dzT2a 시안 3.1). 확정 글과 스트리밍 글을 같은 부품과 같은 규칙으로 그려, 확정될 때 모양이 튀지 않는다.
// 글자·간격 규칙은 `convo.css`의 `.convo-prose`가 맡는다(제목 두 단계, 문단 12, 목록 들여 20, 인용, 표, 인라인 코드).
// 코드 블록은 머리(언어·복사) + 본문이고, 구문 강조는 확정 글에서만 비동기로 입힌다(스트리밍 중에는 줄이 계속 바뀐다).

/** `language-xxx` 클래스에서 언어 이름을 읽는다. 없으면 빈 글 */
function languageOf(className: string | undefined): string {
  const found = /(?:^|\s)language-([\w+#.-]+)/.exec(className ?? "");
  return found?.[1] ?? "";
}

/** 코드 블록 본문 글. 마크다운이 끝에 붙이는 줄바꿈 하나를 뗀다 */
function codeTextOf(children: ReactNode): string {
  const text =
    typeof children === "string" ? children : Array.isArray(children) ? children.join("") : "";
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}

/** 복사 단추. 누르면 2초 동안 체크로 바뀐다 */
export function CopyButton(props: { readonly text: string; readonly label: string }): ReactNode {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return undefined;
    const timer = setTimeout(() => {
      setDone(false);
    }, 2000);
    return () => {
      clearTimeout(timer);
    };
  }, [done]);
  return (
    <IconButton
      size="xs"
      tone="ghost"
      // 교차 전환에서 나가는 아이콘이 단추 안에 겹쳐 남는다(popLayout)
      className="relative"
      label={done ? t("desktop.convo.copied") : props.label}
      onClick={() => {
        detach(
          navigator.clipboard.writeText(props.text).then(() => {
            setDone(true);
            return undefined;
          }),
          rethrow,
        );
      }}
    >
      {/* 복사함: 아이콘이 교차 전환되고 체크 선이 그려진다(dzM2 시안 §9) */}
      <SwapFade swapKey={done ? "done" : "copy"} inline className="inline-flex">
        {done ? <DrawnCheck draw className="text-success-text" /> : <Copy aria-hidden />}
      </SwapFade>
    </IconButton>
  );
}

/** 칠한 줄에 자리 번호를 붙인다. 같은 코드면 같은 줄이라 자리 번호를 키로 쓴다 */
type KeyedLine = {
  readonly id: number;
  readonly tokens: readonly (HighlightedLines[number][number] & { readonly id: number })[];
};

function keyedLinesOf(lines: HighlightedLines): readonly KeyedLine[] {
  return lines.map((line, id) => ({ id, tokens: line.map((token, at) => ({ ...token, id: at })) }));
}

function HighlightedCode(props: { readonly code: string; readonly lang: string }): ReactNode {
  const [lines, setLines] = useState<readonly KeyedLine[] | null>(null);
  useEffect(() => {
    let live = true;
    if (props.lang === "") return undefined;
    detach(
      highlightCode(props.code, props.lang).then((value) => {
        if (live) setLines(keyedLinesOf(value));
        return undefined;
      }),
      rethrow,
    );
    return () => {
      live = false;
    };
  }, [props.code, props.lang]);
  if (lines === null) return props.code;
  return lines.map((line) => (
    <span key={line.id} className="block">
      {line.tokens.length === 0
        ? "\n"
        : line.tokens.map((token) => (
            <span
              key={token.id}
              style={{
                color: token.color,
                fontStyle: token.fontStyle.italic ? "italic" : undefined,
                fontWeight: token.fontStyle.bold ? 600 : undefined,
              }}
            >
              {token.text}
            </span>
          ))}
      {line.id < lines.length - 1 && line.tokens.length > 0 ? "\n" : null}
    </span>
  ));
}

/** 코드 블록. 머리 32px(언어, 복사) + 본문(mono 12/18, 가로 스크롤, 480px 넘으면 안쪽 스크롤) */
function CodeBlock(props: {
  readonly code: string;
  readonly lang: string;
  /** 스트리밍 중이면 강조하지 않는다 */
  readonly streaming: boolean;
}): ReactNode {
  return (
    <div className="convo-code" data-slot="convo-code">
      <div className="convo-code-head">
        <span className="convo-code-lang">
          {props.lang === "" ? t("desktop.convo.code") : props.lang}
        </span>
        <CopyButton text={props.code} label={t("desktop.convo.copyCode")} />
      </div>
      <pre className="convo-code-body" tabIndex={0}>
        <code>
          {props.streaming ? props.code : <HighlightedCode code={props.code} lang={props.lang} />}
        </code>
      </pre>
    </div>
  );
}

function MarkdownCode(props: {
  readonly className?: string | undefined;
  readonly children?: ReactNode;
}): ReactNode {
  const streaming = useContext(StreamingContext);
  const lang = languageOf(props.className);
  const text = codeTextOf(props.children);
  // 울타리 코드는 언어 클래스가 있거나 줄바꿈이 있다. 그 밖은 인라인 코드다
  const block =
    lang !== "" || (typeof props.children === "string" && props.children.includes("\n"));
  if (!block) return <code className="convo-inline-code">{props.children}</code>;
  return <CodeBlock code={text} lang={lang} streaming={streaming} />;
}

function MarkdownLink(props: {
  readonly href?: string | undefined;
  readonly children?: ReactNode;
}): ReactNode {
  const open = useOpenSource();
  const { href } = props;
  return (
    <a
      href={href}
      className="convo-link"
      onClick={(event) => {
        event.preventDefault();
        if (href !== undefined) open(href);
      }}
    >
      {props.children}
    </a>
  );
}

/**
 * 마크다운 부품. 모듈에 한 번만 만든다: 렌더마다 새 함수를 넘기면 react-markdown이 코드 블록·표·링크를 델타마다 다시 마운트해
 * 스트리밍 중 깜빡이고(복사 상태, 가로 스크롤이 풀림) 확정 때 코드 강조가 처음부터 다시 돈다(dzM2 시안 §5)
 */
const COMPONENTS: Components = {
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children }) => <MarkdownCode className={className}>{children}</MarkdownCode>,
  a: ({ href, children }) => <MarkdownLink href={href}>{children}</MarkdownLink>,
  table: ({ children }) => (
    <div className="convo-table" tabIndex={0}>
      <table>{children}</table>
    </div>
  ),
};

/** 답 본문 마크다운. `streaming`이면 미완성 표식을 보정해 그린다 */
type MarkdownBodyProps = {
  readonly text: string;
  readonly streaming?: boolean;
  /** 글 크기 단계. reply는 15/23(답 본문), compact는 13/20(생각, 보고, 계획 미리보기) */
  readonly size?: "reply" | "compact";
};

export const MarkdownBody: NamedExoticComponent<MarkdownBodyProps> = memo(function MarkdownBody(
  props: MarkdownBodyProps,
): ReactNode {
  const streaming = props.streaming === true;
  return (
    <StreamingContext value={streaming}>
      <div className="convo-prose" data-size={props.size ?? "reply"}>
        {streaming
          ? renderStreamingMarkdown(props.text, { components: COMPONENTS })
          : renderMarkdown(props.text, { components: COMPONENTS })}
      </div>
    </StreamingContext>
  );
});
