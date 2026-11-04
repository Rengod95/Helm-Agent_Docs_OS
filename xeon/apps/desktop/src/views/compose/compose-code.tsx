// 구성기의 코드 보기(§6.28.5, 읽기 전용). 설치 그룹의 매니페스트 블록을 줄로 보이고, 그 아래 "다음 길" 띠로 파일 만들기로 가는 길을 준다.
// 플러그인 빌더(`authoring` 확장)가 켜져 있으면 "플러그인 빌더로 만들기", 꺼져 있거나 없으면 "플러그인 빌더 켜기", 엔진에 연결되지 않았으면 문장만 보인다.
// 설치 그룹은 고치지 않는다. 고치려면 새 그룹을 만든다(§6.28).
import { t } from "@fresnel/client/i18n";
import { blockRowsOf, compositionOf, type BlockRow, type TabLink } from "@fresnel/client/workbench";
import { assertNever } from "@fresnel/contracts";
import type { CompositionDecl } from "@fresnel/contracts/extensions";
import type { ExtListEntry } from "@fresnel/contracts/wire";
import { Button } from "@caustic/react";
import { useCallback, useState, type ReactNode } from "react";
import { useCommands } from "../commands.ts";
import { useTabRead } from "../workbench/tab-read.ts";
import { NoComposition, ReadGate } from "./compose-group.tsx";

/** 플러그인 빌더 확장의 이름(§6.29). 켜고 끄기는 이 확장의 on/off다 */
export const AUTHORING_EXT = "authoring";

/** 목록의 확장 상태. 목록에 없으면 null로 넘긴다 */
type BuilderStatus = ExtListEntry["status"];

/** "다음 길" 띠의 모양: 만들기, 켜기, 연결 전(문장만) */
type ForwardState = "make" | "enable" | "offline";

/** 엔진에 연결되어 있지 않으면 문장만, 연결되어 있으면 플러그인 빌더가 켜졌는지에 따라 만들기 또는 켜기다 */
export function forwardStateOf(link: TabLink, builder: BuilderStatus | null): ForwardState {
  if (link !== "live") return "offline";
  return builder === "enabled" ? "make" : "enable";
}

/** 블록 한 줄. 선언된 것만 쓴다: `<id> · <연산> · <단계>`에 훅 이름을 붙인다 */
export function codeLineOf(row: BlockRow): string {
  const hooks = row.hooks.length === 0 ? "" : ` [${row.hooks.join(", ")}]`;
  return `${row.id} · ${row.op} · ${row.stage}${hooks}`;
}

/** 매니페스트 블록을 줄 번호와 함께 보인다. 제목이 id와 같으면 제목 줄은 뺀다 */
export function CodeBlocks(props: { readonly composition: CompositionDecl }): ReactNode {
  return (
    <ol
      aria-label={t("desktop.compose.blocks")}
      className="m-0 grid list-none gap-px overflow-hidden rounded-lg border border-border-subtle bg-border-subtle p-0"
    >
      {blockRowsOf(props.composition).map((row, index) => (
        <li
          key={row.id}
          className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-3 bg-surface-base p-2.5"
        >
          <span
            aria-hidden
            className="select-none text-end font-mono text-mono-sm text-text-tertiary"
          >
            {index + 1}
          </span>
          <div className="grid min-w-0 gap-0.5">
            <code className="whitespace-pre-wrap break-words font-mono text-mono-sm text-text-primary">
              {codeLineOf(row)}
            </code>
            {row.title === row.id ? null : (
              <span className="text-ui-sm text-text-tertiary">{row.title}</span>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

function sentenceOf(state: ForwardState): string {
  switch (state) {
    case "make":
      return t("desktop.compose.code.forward.make");
    case "enable":
      return t("desktop.compose.code.forward.enable");
    case "offline":
      return t("desktop.compose.code.forward.offline");
    default:
      return assertNever(state, "ForwardState");
  }
}

/** "다음 길" 띠: 문장 하나와 다음 동작 하나. 켜는 중에는 켜기 단추가 도는 표식을 단다 */
export function ForwardStrip(props: {
  readonly state: ForwardState;
  readonly busy: boolean;
  readonly onMake: () => void;
  readonly onEnable: () => void;
}): ReactNode {
  const { state } = props;
  return (
    <section
      aria-label={t("desktop.compose.code.next")}
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border-subtle p-3"
    >
      <p className="m-0 text-ui-sm text-text-secondary">{sentenceOf(state)}</p>
      {state === "make" ? (
        <Button size="sm" onClick={props.onMake}>
          {t("desktop.compose.code.forward.makeButton")}
        </Button>
      ) : state === "enable" ? (
        <Button size="sm" loading={props.busy} onClick={props.onEnable}>
          {t("desktop.compose.code.forward.enableButton")}
        </Button>
      ) : null}
    </section>
  );
}

/** 고른 설치 그룹 하나의 코드 보기. 읽기는 그룹 보기와 같이 `workbench.get`으로 한다 */
export function CodeSource(props: {
  readonly name: string;
  readonly link: TabLink;
  readonly builder: BuilderStatus | null;
  readonly onMake: (name: string) => void;
  readonly onEnable: () => void;
}): ReactNode {
  const commands = useCommands();
  const [version, setVersion] = useState(0);
  const load = useCallback(() => commands.workbench.get(props.name), [commands, props.name]);
  const read = useTabRead(`compose-code:${props.name}:${version}`, props.link, load);
  return (
    <div className="grid gap-3">
      <ReadGate
        read={read}
        onRetry={() => {
          setVersion((current) => current + 1);
        }}
      >
        {(detail) => {
          const composition = compositionOf(detail.manifest);
          return composition.kind === "none" ? (
            <NoComposition />
          ) : (
            <CodeBlocks composition={composition.composition} />
          );
        }}
      </ReadGate>
      <ForwardStrip
        state={forwardStateOf(props.link, props.builder)}
        busy={props.builder === "enabling"}
        onMake={() => props.onMake(props.name)}
        onEnable={props.onEnable}
      />
    </div>
  );
}
