// "새 그룹" 시작 화면: 구성 안의 동작이라 따로 내비가 없다(C-6). 이름과 놓을 곳, 시작점을 고르면 같은 구성기로 넘어간다.
// 시작점은 Helm 복제와 플러그인 빌더 종류 목록(고정 목록이 아니다, authoring §3.4). 선 격자 한 장에 같은 무게로 놓는다.
// 오른쪽은 이 보기 기준에서 쓸 수 있는 기능을 흐리게 미리 보인다(§6.28.1).
import { Field, Input } from "@caustic/react";
import { LineGridBlock, LineGridCell, LineGridEmpty, PageBody, PageSection, T } from "../../_shell";
import { providers } from "../../wb-compose/fixtures";
import { nameError, targetFolder, type Action, type Model } from "../flow";

interface Start {
  id: string;
  title: string;
  line: string;
  status?: string;
  blocked?: boolean;
}

const STARTS: Start[] = [
  { id: "helm", title: "Helm 복제", line: `${T.block} 일곱을 그대로 가져와요` },
  { id: "group.drive", title: `주도 ${T.group}`, line: `${T.step}를 스스로 진행해요` },
  { id: "group.policy", title: `정책 ${T.group}`, line: "도구 호출을 막거나 바꿔요" },
  { id: "group.observe", title: `관찰 ${T.group}`, line: "기록만 남겨요" },
  {
    id: "plugin.l2-provider",
    title: `${T.capability} ${T.plugin}`,
    line: `${T.capability}을 내줘요`,
    status: "미리 보기",
  },
  { id: "plugin.tool", title: `도구 ${T.plugin}`, line: "도구를 더해요", status: "미리 보기" },
  {
    id: "x.hook",
    title: T.xHook,
    line: "외부 프로그램을 불러요",
    status: T.catalogBlocked,
    blocked: true,
  },
];

export function NewGroup({ s, dispatch }: { s: Model; dispatch: (a: Action) => void }) {
  const err = nameError(s.name);
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_15rem] gap-8 overflow-y-auto px-4 pb-6">
      <PageBody>
        <div className="grid grid-cols-2 items-start gap-4">
          <Field label={`${T.group} 이름`} {...(err !== null ? { error: err } : {})}>
            <Input
              size="sm"
              variant="soft"
              placeholder="lens-review"
              value={s.name}
              onChange={(e: { currentTarget: { value: string } }) =>
                dispatch({ t: "name", value: e.currentTarget.value })
              }
            />
          </Field>
          <Field label={T.targetFolder}>
            <Input
              size="sm"
              variant="soft"
              readOnly
              placeholder={targetFolder("lens-review")}
              value={s.name === "" ? "" : targetFolder(s.name)}
              className="font-mono"
            />
          </Field>
        </div>

        <PageSection title={T.startPoint}>
          <LineGridBlock columns={3} role="radiogroup" aria-label={T.startPoint}>
            {STARTS.map((c) => (
              <LineGridCell
                key={c.id}
                role="radio"
                aria-checked={s.start === c.id}
                aria-disabled={c.blocked === true}
                tabIndex={c.blocked === true ? -1 : 0}
                selected={s.start === c.id}
                onClick={() => {
                  if (c.blocked !== true) dispatch({ t: "start", id: c.id });
                }}
                onKeyDown={(e) => {
                  if ((e.key === "Enter" || e.key === " ") && c.blocked !== true) {
                    e.preventDefault();
                    dispatch({ t: "start", id: c.id });
                  }
                }}
                className={`grid min-h-24 content-start gap-1 outline-none focus-visible:focus-ring ${c.blocked === true ? "cursor-not-allowed" : "cursor-pointer hover:bg-neutral-soft"}`}
              >
                <span
                  className={`text-title-3 ${c.blocked === true ? "text-text-tertiary" : "text-text-primary"}`}
                >
                  {c.title}
                </span>
                <span className="text-body text-text-tertiary">{c.line}</span>
                {c.status !== undefined && (
                  <span className="text-footnote text-text-tertiary">{c.status}</span>
                )}
              </LineGridCell>
            ))}
            <LineGridEmpty span={2} />
          </LineGridBlock>
        </PageSection>
      </PageBody>

      <PageSection
        level="group"
        title={`이 ${T.context}의 ${T.capability}`}
        className="content-start"
      >
        <ul className="m-0 grid list-none p-0">
          {providers.flatMap((p) =>
            p.caps.map((c) => (
              <li
                key={c.cap}
                className="flex items-baseline justify-between gap-2 border-b border-border-subtle py-2 last:border-b-0"
              >
                <span className="truncate font-mono text-mono-sm text-text-tertiary">{c.cap}</span>
                <span className="flex-none text-footnote text-text-tertiary">{p.name}</span>
              </li>
            )),
          )}
        </ul>
      </PageSection>
    </div>
  );
}
