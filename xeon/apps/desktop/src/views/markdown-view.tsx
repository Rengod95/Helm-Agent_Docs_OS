import { MessageCode } from "@caustic/react";
import { assertNever } from "@fresnel/contracts";
import { Children, type ReactNode } from "react";
import type { Block, Inline } from "./markdown-blocks.ts";

// markdown-blocks.ts가 만든 블록을 React 요소로만 그린다. HTML 문자열을 만들거나 넣는 속성은 쓰지 않는다.
// 글은 React가 이스케이프하므로 `<b>` 같은 표지도 글자 그대로 보인다. 링크는 글만 그린다(주소는 파서가 버린다).

const ROOT = "grid min-w-0 gap-2 text-ui-sm text-text-primary [overflow-wrap:anywhere]";
const TEXT = "m-0 whitespace-pre-line";
const HEADING = "m-0 text-ui-md font-semibold text-text-primary whitespace-pre-line";
const LIST = "m-0 grid min-w-0 gap-1 pl-5 whitespace-pre-line";
const CODE = "m-0 rounded-md bg-neutral-track p-2 font-mono text-mono-sm whitespace-pre-wrap";

/** Markdown 블록 목록. 빈 목록이면 빈 칸이다 */
export function MarkdownView(props: { readonly blocks: readonly Block[] }): ReactNode {
  return (
    <div className={ROOT}>
      {inOrder(props.blocks, (block) => (
        <BlockView block={block} />
      ))}
    </div>
  );
}

/**
 * 목록을 자식으로 펼친다. 키는 React의 Children.map이 자리로 정한다(글에서 만든 목록은 순서가 바뀌지 않는다).
 * 자리 번호 배열을 넘기는 이유는 객체를 자식으로 넘기면 React가 거부하기 때문이다. native-tree.tsx의 inOrder와 같은 방식이다.
 */
function inOrder<T>(values: readonly T[], render: (value: T) => ReactNode): ReactNode {
  const positions: number[] = values.map((_value, position) => position);
  return Children.map(positions, (position) => {
    const value = values[position];
    return value === undefined ? null : render(value);
  });
}

function BlockView(props: { readonly block: Block }): ReactNode {
  const { block } = props;
  switch (block.type) {
    case "heading":
      // 제목 단계는 글의 위계를 알리는 값만 두고, 크기는 모두 같은 소제목 크기로 그린다
      return (
        <p role="heading" aria-level={block.level} className={HEADING}>
          <InlineView inlines={block.inlines} />
        </p>
      );
    case "paragraph":
      return (
        <p className={TEXT}>
          <InlineView inlines={block.inlines} />
        </p>
      );
    case "bullets":
      return (
        <ul className={`${LIST} list-disc`}>
          {inOrder(block.items, (item) => (
            <li>
              <InlineView inlines={item} />
            </li>
          ))}
        </ul>
      );
    case "numbered":
      return (
        <ol start={block.start} className={`${LIST} list-decimal`}>
          {inOrder(block.items, (item) => (
            <li>
              <InlineView inlines={item} />
            </li>
          ))}
        </ol>
      );
    case "code":
      return (
        <pre className={CODE}>
          <code>{block.text}</code>
        </pre>
      );
    case "rule":
      return <hr className="m-0 border-0 border-t border-border-subtle" />;
    default:
      return assertNever(block, "markdown block");
  }
}

function InlineView(props: { readonly inlines: readonly Inline[] }): ReactNode {
  return inOrder(props.inlines, (token) => <InlineToken token={token} />);
}

function InlineToken(props: { readonly token: Inline }): ReactNode {
  const { token } = props;
  switch (token.type) {
    case "text":
      return token.text;
    case "strong":
      return <strong className="font-semibold">{token.text}</strong>;
    case "em":
      return <em>{token.text}</em>;
    case "code":
      return <MessageCode>{token.text}</MessageCode>;
    default:
      return assertNever(token, "markdown inline");
  }
}
