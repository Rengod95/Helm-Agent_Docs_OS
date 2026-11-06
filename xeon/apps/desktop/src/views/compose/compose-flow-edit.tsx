// 흐름 초안의 편집 자리(§6.28.2, S5): 단계 종류 팔레트와 고른 노드의 속성. 선은 포트를 끌지 않고 속성의 "다음 단계"에서 잇고 끊는다.
// 모든 바꿈은 `FlowDraft`의 순수 함수(`withNode`, `withNodeText`, `withTransition` …)를 거쳐 `onDraft`로 올린다.
import { t } from "@fresnel/client/i18n";
import {
  withInitial,
  withNode,
  withNodeText,
  withoutNode,
  withoutTransition,
  withTransition,
  type FlowDraft,
} from "@fresnel/client/workbench";
import {
  PHASE_NODE_KINDS,
  type PhaseNodeDecl,
  type PhaseNodeKind,
} from "@fresnel/contracts/extensions";
import type { WireManifestIssue } from "@fresnel/contracts/wire";
import {
  Button,
  EmptyState,
  Field,
  IconButton,
  Input,
  List,
  ListRow,
  Select,
  SelectOption,
} from "@caustic/react";
import { X } from "@caustic/react/icons";
import { useState, type ReactNode } from "react";
import { InfoTip } from "../craft/info-tip.tsx";
import { IssueList } from "./compose-check.tsx";
import { NODE_TEXT } from "./compose-text.ts";

const MUTED = "m-0 text-ui-sm text-text-tertiary";
/** 팔레트와 속성의 구역 제목(시안 PageSection group 제목과 같은 글 역할) */
const HEAD = "m-0 text-title-3 text-text-primary";

export interface FlowEditorProps {
  readonly draft: FlowDraft;
  readonly selected: string | null;
  /** 노드 id → 그 노드의 검사 이슈 */
  readonly issues: ReadonlyMap<string, readonly WireManifestIssue[]>;
  readonly onSelect: (id: string | null) => void;
  readonly onDraft: (draft: FlowDraft) => void;
}

/** 팔레트와 속성. 고른 노드가 없으면 속성 자리는 안내 한 줄이다 */
export function FlowEditor(props: FlowEditorProps): ReactNode {
  const { draft } = props;
  const node = draft.nodes.find((item) => item.id === props.selected);
  return (
    <div className="grid w-72 max-w-full flex-none content-start gap-3">
      <Palette
        onAdd={(kind) => {
          const next = withNode(draft, kind);
          const added = next.nodes.at(-1);
          props.onDraft(next);
          if (added !== undefined) props.onSelect(added.id);
        }}
      />
      {node === undefined ? (
        <EmptyState
          size="sm"
          surface="none"
          mark={null}
          title={t("desktop.compose.flow.inspect.empty")}
        />
      ) : (
        <Inspector
          key={node.id}
          draft={draft}
          node={node}
          initial={node.id === draft.initial}
          issues={props.issues.get(node.id) ?? []}
          onSelect={props.onSelect}
          onDraft={props.onDraft}
        />
      )}
    </div>
  );
}

/** 단계 종류 목록. 누르면 노드 하나가 더해지고 그 노드가 고른 것이 된다 */
function Palette(props: { readonly onAdd: (kind: PhaseNodeKind) => void }): ReactNode {
  return (
    <div className="grid gap-1.5">
      <p className={HEAD}>{t("desktop.compose.flow.palette.head")}</p>
      <List variant="ghost" size="xs" aria-label={t("desktop.compose.flow.palette.label")}>
        {PHASE_NODE_KINDS.map((kind) => (
          <ListRow
            key={kind}
            title={t(NODE_TEXT[kind])}
            onClick={() => {
              props.onAdd(kind);
            }}
          />
        ))}
      </List>
    </div>
  );
}

/**
 * 글 한 줄. 입력은 줄마다 바꾸면 공백이 지워지므로 로컬에 두고 떠날 때(또는 Enter) 반영한다.
 * `key`에 지금 값을 넣어, 값이 밖에서 바뀌면(되돌리기 등) 새로 그린다.
 */
function TextField(props: {
  readonly label: string;
  readonly value: string;
  readonly placeholder: string;
  readonly maxLength: number;
  readonly onCommit: (text: string) => void;
}): ReactNode {
  const [text, setText] = useState(props.value);
  return (
    <Field label={props.label}>
      <Input
        size="sm"
        variant="soft"
        value={text}
        placeholder={props.placeholder}
        maxLength={props.maxLength}
        onValueChange={setText}
        onBlur={() => {
          if (text.trim() !== props.value) props.onCommit(text);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </Field>
  );
}

/** 고른 노드의 속성: 글, 시작 지정, 지우기, 잇기, 나가는 선 */
function Inspector(props: {
  readonly draft: FlowDraft;
  readonly node: PhaseNodeDecl;
  readonly initial: boolean;
  readonly issues: readonly WireManifestIssue[];
  readonly onSelect: (id: string | null) => void;
  readonly onDraft: (draft: FlowDraft) => void;
}): ReactNode {
  const { draft, node } = props;
  const [target, setTarget] = useState<string | null>(null);
  const others = draft.nodes.filter((item) => item.id !== node.id);
  const outgoing = draft.transitions.filter((edge) => edge.from === node.id);
  const titleOf = (id: string): string => draft.nodes.find((item) => item.id === id)?.title ?? id;
  const connectable = target !== null && !outgoing.some((edge) => edge.to === target);
  const titleValue = node.title ?? "";
  return (
    <div className="grid content-start gap-3">
      <div className="flex min-w-0 flex-wrap items-baseline gap-2.5">
        <h3 className={HEAD}>{node.title ?? node.id}</h3>
        <span className="text-ui-sm text-text-tertiary">{t(NODE_TEXT[node.kind])}</span>
        {props.initial ? (
          <span className="text-footnote text-text-tertiary">
            {t("desktop.compose.flow.initial")}
          </span>
        ) : null}
      </div>
      <IssueList issues={props.issues} />
      <TextField
        key={`title:${node.id}:${titleValue}`}
        label={t("desktop.compose.flow.inspect.title")}
        value={titleValue}
        placeholder={node.id}
        maxLength={64}
        onCommit={(title) => {
          props.onDraft(withNodeText(draft, node.id, { title }));
        }}
      />
      {node.kind === "human" ? (
        <TextField
          key={`ask:${node.id}:${node.askTitle ?? ""}`}
          label={t("desktop.compose.flow.inspect.ask")}
          value={node.askTitle ?? ""}
          placeholder={node.id}
          maxLength={128}
          onCommit={(askTitle) => {
            props.onDraft(withNodeText(draft, node.id, { askTitle }));
          }}
        />
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={props.initial}
          onClick={() => {
            props.onDraft(withInitial(draft, node.id));
          }}
        >
          {t("desktop.compose.flow.inspect.setStart")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={draft.nodes.length <= 1}
          onClick={() => {
            props.onDraft(withoutNode(draft, node.id));
            props.onSelect(null);
          }}
        >
          {t("desktop.compose.flow.inspect.remove")}
        </Button>
        {draft.nodes.length <= 1 ? (
          <InfoTip text={t("desktop.compose.flow.inspect.keepOne")} />
        ) : null}
      </div>
      <div className="grid gap-2">
        <div className="flex flex-wrap items-end gap-2">
          <Field label={t("desktop.compose.flow.inspect.next")}>
            <Select
              size="sm"
              value={target ?? ""}
              placeholder={t("desktop.compose.flow.inspect.pickNext")}
              onValueChange={(value) => {
                setTarget(value === "" ? null : value);
              }}
            >
              {others.map((other) => (
                <SelectOption key={other.id} value={other.id}>
                  {other.title ?? other.id}
                </SelectOption>
              ))}
            </Select>
          </Field>
          <Button
            size="sm"
            variant="outline"
            disabled={!connectable}
            onClick={() => {
              if (target !== null) props.onDraft(withTransition(draft, node.id, target));
              setTarget(null);
            }}
          >
            {t("desktop.compose.flow.inspect.connect")}
          </Button>
          <InfoTip text={t("desktop.compose.flow.inspect.connectInfo")} />
        </div>
      </div>
      <div className="grid gap-1.5">
        <p className={HEAD}>{t("desktop.compose.flow.inspect.outgoing")}</p>
        {outgoing.length === 0 ? (
          <p className={MUTED}>{t("desktop.compose.flow.inspect.noOutgoing")}</p>
        ) : (
          <ul className="m-0 grid list-none gap-1.5 p-0">
            {outgoing.map((edge) => (
              <li
                key={`${edge.to}:${edge.event ?? ""}`}
                className="flex items-center justify-between gap-2 text-ui-sm text-text-secondary"
              >
                <span>
                  {t("desktop.compose.flow.to", { to: titleOf(edge.to) })}
                  {edge.event === undefined ? "" : ` · ${edge.event}`}
                </span>
                <IconButton
                  size="xs"
                  variant="ghost"
                  label={t("desktop.compose.flow.inspect.disconnect", { to: titleOf(edge.to) })}
                  onClick={() => {
                    props.onDraft(withoutTransition(draft, edge.from, edge.to));
                  }}
                >
                  <X aria-hidden />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
