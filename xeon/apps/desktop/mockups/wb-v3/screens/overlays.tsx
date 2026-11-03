// 구조 화면 위 덮개 둘: (1) "보기 기준" 처음 설명(글만, 그림 없음), (2) 에이전트 코어(L1)에 플러그인 더하기 시작 시트.
// 떠 있는 것이라 옛 덮개 그림자(shadow-3)를 쓴다. 행 구분은 1px 얇은 선이다.
import {
  Button,
  ChoiceGroup,
  ChoiceGroupItem,
  IconButton,
  SectionHeader,
  Stepper,
} from "@caustic/react";
import { LineGridBlock, LineGridCell, X as XIcon } from "../../_shell";
import { PageSection } from "../../_shell/page";
import { T } from "../../_shell/terms";
import { useMock } from "../store";

const FLOAT = "rounded-2xl bg-surface-raised shadow-3";

const CONCEPTS = [
  { id: "all", title: "설치 전체", line: "이 기기에 깔린 플러그인 전부" },
  { id: "thread", title: T.contextThread, line: "그 대화에서 지금 도는 것" },
  { id: "trial", title: T.trialThread, line: "떼어 내서 돌려 보는 대화" },
  { id: "preset", title: T.profile, line: "저장해 둔 켜기·끄기 묶음" },
] as const;

export function ExplainOverlay() {
  const m = useMock();
  return (
    <div className="absolute inset-0 z-20 flex items-start bg-bg-app/70 p-6 backdrop-blur-[2px]">
      <section
        aria-label={`${T.context}과 ${T.profile}`}
        className={`${FLOAT} grid w-full max-w-[640px] gap-6 p-6`}
      >
        <SectionHeader
          size="md"
          headingLevel={2}
          title={`${T.context}은 "어느 런타임을 보고 있나"예요`}
          action={
            <IconButton
              size="md"
              variant="ghost"
              label="닫기"
              onClick={() => m.set({ overlay: null })}
            >
              <XIcon />
            </IconButton>
          }
        />
        <dl aria-label={`${T.context} 종류`} className="m-0 grid">
          {CONCEPTS.map((c) => (
            <div
              key={c.id}
              className="grid grid-cols-[7rem_minmax(0,1fr)] items-baseline border-t border-border-subtle py-2.5 first:border-t-0"
            >
              <dt className="text-title-3 text-text-primary">{c.title}</dt>
              <dd className="m-0 text-body text-text-secondary">{c.line}</dd>
            </div>
          ))}
        </dl>
        {/* 보기와 바꾸기는 나란히 견주는 한 쌍: 카드 안에 카드를 두지 않고 선 칸으로 나눈다. 바깥 "+" 표식은 끈다. */}
        <LineGridBlock columns={2} marks={false} className="border-t border-border-subtle">
          <LineGridCell className="grid content-start gap-1 ps-0">
            <span className="text-title-3 text-text-primary">보기</span>
            <span className="text-text-secondary">{T.context}을 바꿔도 런타임은 그대로예요.</span>
          </LineGridCell>
          <LineGridCell className="grid content-start gap-1 pe-0">
            <span className="text-title-3 text-text-primary">바꾸기</span>
            <span className="text-text-secondary">
              켜기·끄기와 {T.profile} 적용만 런타임을 바꿔요.
            </span>
          </LineGridCell>
        </LineGridBlock>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => m.set({ overlay: null, view: "t1" })}>
            대화로 보기
          </Button>
          <Button size="sm" variant="solid" onClick={() => m.set({ overlay: null })}>
            알겠어요
          </Button>
        </div>
      </section>
    </div>
  );
}

const CAN = [
  { id: "provider", title: "모델 provider 등록", end: undefined },
  { id: "hook", title: "요청·도구 훅에 훅", end: undefined },
  { id: "tool", title: "도구 등록", end: undefined },
  { id: "drive", title: T.lead, end: `${T.layerL3}만` },
] as const;

/** 에이전트 코어(L1)에 더하기: 시작 단계. */
export function AddL1Sheet() {
  const m = useMock();
  return (
    <section
      aria-label={`${T.layerL1}에 ${T.plugin} 더하기`}
      className={`${FLOAT} absolute bottom-8 right-8 top-6 z-20 flex w-[380px] flex-col overflow-hidden`}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto p-6">
        <SectionHeader
          size="md"
          headingLevel={2}
          title={`${T.layerL1}에 ${T.plugin} 더하기`}
          description="매 턴의 모델·도구·컨텍스트를 바꿔요."
          action={
            <IconButton
              size="md"
              variant="ghost"
              label="닫기"
              onClick={() => m.set({ overlay: null })}
            >
              <XIcon />
            </IconButton>
          }
        />
        <Stepper
          aria-label="더하기 단계"
          size="xs"
          steps={[
            { id: "get", label: "가져오기", status: "now" },
            { id: "check", label: "검사·신뢰", status: "todo" },
            { id: "on", label: "켜기", status: "todo" },
          ]}
          statusLabels={{ done: "끝남", now: "지금", todo: "남음", failed: "멈춤" }}
        />
        <PageSection title="이 층에서 할 수 있는 것" level="group">
          <ul className="m-0 grid list-none p-0">
            {CAN.map((c) => (
              <li
                key={c.id}
                className="flex min-h-9 items-center justify-between gap-3 border-t border-border-subtle py-1.5 text-body text-text-primary first:border-t-0"
              >
                {c.title}
                {c.end !== undefined && (
                  <span className="text-footnote text-text-tertiary">{c.end}</span>
                )}
              </li>
            ))}
          </ul>
        </PageSection>
        <PageSection title="어디서 가져올까요" level="group">
          <ChoiceGroup appearance="answer" defaultValue="helper" aria-label="가져올 곳">
            <ChoiceGroupItem value="helper" title="만들기 도우미로" />
            <ChoiceGroupItem value="folder" title="폴더에서" />
            <ChoiceGroupItem value="clone" title="설치된 것 복제" />
          </ChoiceGroup>
        </PageSection>
      </div>
      <div className="flex flex-none justify-end gap-2 px-6 pb-6">
        <Button size="sm" variant="ghost" onClick={() => m.set({ overlay: null })}>
          취소
        </Button>
        <Button
          size="sm"
          variant="solid"
          onClick={() => m.notify("만들기 도우미가 대화에서 시작해요")}
        >
          다음
        </Button>
      </div>
    </section>
  );
}
