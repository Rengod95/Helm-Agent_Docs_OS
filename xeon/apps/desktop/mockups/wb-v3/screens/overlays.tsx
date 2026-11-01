// 캔버스 위 덮개 둘: (1) "보는 대상" 처음 설명, (2) 엔진(L1)에 플러그인 더하기 시작 시트.
import { Button, IconButton } from "@caustic/react";
import type { ReactNode } from "react";
import {
  Check,
  Eye,
  FolderOpen,
  SlidersHorizontal,
  SquareStack,
  WandSparkles,
  X as XIcon,
} from "../../_shell";
import { Art } from "../parts/art";
import { LayerCode, ink } from "../parts/kit";
import { useMock } from "../store";

const SPOT = {
  all: "spot-plugin",
  thread: "spot-context",
  trial: "spot-trial",
  preset: "spot-profile",
} as const;

function Concept({
  k,
  title,
  line,
  eg,
}: {
  k: "all" | "thread" | "trial" | "preset";
  title: string;
  line: string;
  eg: string;
}) {
  return (
    <div className="grid content-start gap-1">
      <div className="relative grid h-[100px] place-items-center overflow-hidden rounded-lg bg-surface-base">
        <Art name={SPOT[k]} className="w-[132px]" />
      </div>
      <span className="pt-1 text-ui-sm text-text-primary">{title}</span>
      <span className="text-ui-xs text-text-secondary">{line}</span>
      <span className="text-ui-xs text-text-tertiary">{eg}</span>
    </div>
  );
}

export function ExplainOverlay() {
  const m = useMock();
  return (
    <div className="absolute inset-0 z-20 flex items-start bg-bg-app/70 p-3 backdrop-blur-[2px]">
      <section
        aria-label="보는 대상과 프리셋"
        className="relative w-full max-w-[720px] rounded-2xl bg-surface-raised p-5 shadow-4"
      >
        {/* 왼쪽 패널 "보는 대상" 칸을 가리키는 꼬리 */}
        <span
          aria-hidden
          className="absolute -left-1.5 top-[54px] size-3 rotate-45 bg-surface-raised"
        />
        <div className="flex items-start gap-3">
          <div className="grid flex-1 gap-1">
            <h2 className="m-0 text-ui-lg text-text-primary">
              보는 대상은 "어느 런타임을 보고 있나"예요
            </h2>
            <p className="m-0 text-ui-dense text-text-secondary">
              왼쪽 위 칸에서 고르면 작업대 모든 화면이 그 대상을 보여 줘요. 고르기만 해서는 아무것도
              바뀌지 않아요.
            </p>
          </div>
          <IconButton
            size="sm"
            variant="ghost"
            label="닫기"
            onClick={() => m.set({ overlay: null })}
          >
            <XIcon />
          </IconButton>
        </div>
        <div className="mt-4 grid grid-cols-4 gap-3">
          <Concept
            k="all"
            title="설치 전체"
            line="이 기기에 깔린 플러그인 전부"
            eg="켜짐·꺼짐은 대화마다 달라 '설치됨'만"
          />
          <Concept
            k="thread"
            title="대화"
            line="그 대화에서 지금 도는 것"
            eg="실시간 · 진행권 · 다음 단계"
          />
          <Concept
            k="trial"
            title="시험 대화"
            line="떼어 내서 돌려 보는 대화"
            eg="단계마다 멈추고 한 칸씩"
          />
          <Concept
            k="preset"
            title="프리셋"
            line="저장해 둔 켜기·끄기 묶음"
            eg="보기만 하면 설계도예요"
          />
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <div
            className="flex gap-3 rounded-xl p-3"
            style={{ boxShadow: "inset 0 0 0 1px var(--edge)" }}
          >
            <div className="relative grid h-[72px] w-[100px] flex-none place-items-center rounded-lg bg-surface-base">
              <Art name="spot-replay" className="w-[96px]" />
            </div>
            <div className="grid content-start gap-1">
              <span className="flex items-center gap-1.5 text-ui-sm text-text-primary [&_svg]:size-3.5">
                <Eye /> 보기
              </span>
              <span className="text-ui-xs text-text-secondary">
                보는 대상을 바꿔도 런타임은 그대로예요.
              </span>
              <span className="text-ui-xs text-text-tertiary">눈 아이콘 · 회색 · 왼쪽 위 칸</span>
            </div>
          </div>
          <div className="flex gap-3 rounded-xl bg-accent-soft p-3">
            <div className="relative grid h-[72px] w-[100px] flex-none place-items-center rounded-lg bg-surface-raised">
              <Art name="layer-stack-insert" className="w-[70px]" />
            </div>
            <div className="grid content-start gap-1">
              <span className="flex items-center gap-1.5 text-ui-sm text-accent-text [&_svg]:size-3.5">
                <SlidersHorizontal /> 바꾸기
              </span>
              <span className="text-ui-xs text-text-secondary">
                켜기·끄기와 프리셋 적용만 런타임을 바꿔요.
              </span>
              <span className="text-ui-xs text-text-tertiary">
                늘 "이 대화에 · 이번 단계가 끝나면"이라고 말해요.
              </span>
            </div>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <span className="flex-1 text-ui-xs text-text-tertiary">
            프리셋은 런타임 설정에 저장돼 CLI·서비스와 같이 써요.
          </span>
          <Button size="sm" variant="ghost" onClick={() => m.set({ overlay: null, view: "t1" })}>
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

function Can({ ok, children, code }: { ok: boolean; children: ReactNode; code?: string }) {
  return (
    <li className="flex items-start gap-2 text-ui-xs">
      <span
        className={`mt-0.5 grid size-4 flex-none place-items-center rounded-full [&_svg]:size-3 ${ok ? "bg-success-soft text-success-text" : "bg-surface-base text-text-tertiary"}`}
      >
        {ok ? <Check /> : <XIcon />}
      </span>
      <span className={ok ? "text-text-primary" : "text-text-secondary"}>
        {children}
        {code && <span className="ms-1.5 font-mono text-mono-sm text-text-tertiary">{code}</span>}
      </span>
    </li>
  );
}

function Source({
  icon,
  title,
  line,
  sel,
  tag,
}: {
  icon: ReactNode;
  title: string;
  line: string;
  sel?: boolean;
  tag?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={sel}
      className="flex items-start gap-2.5 rounded-xl p-2.5 text-start outline-none focus-visible:shadow-focus [&_svg]:size-4"
      style={{
        background: sel ? "var(--cs-color-surface-base)" : "transparent",
        boxShadow: sel ? `0 0 0 1.5px ${ink("L1")}` : "inset 0 0 0 1px var(--edge)",
      }}
    >
      <span
        className="grid size-7 flex-none place-items-center rounded-md"
        style={{ background: "var(--tint-L1)", color: ink("L1") }}
      >
        {icon}
      </span>
      <span className="grid min-w-0 gap-0.5">
        <span className="flex items-center gap-1.5 text-ui-sm text-text-primary">
          {title}
          {tag && <span className="text-ui-xs text-text-tertiary">{tag}</span>}
        </span>
        <span className="text-ui-xs text-text-secondary">{line}</span>
      </span>
    </button>
  );
}

/** 엔진(L1)에 더하기: 시작 단계. 캔버스 L1 띠의 "여기에 놓여요" 자리가 맥박으로 함께 보인다. */
export function AddL1Sheet() {
  const m = useMock();
  return (
    <section
      aria-label="에이전트 핵심에 플러그인 더하기"
      className="absolute bottom-3 right-3 top-3 z-20 flex w-[360px] flex-col rounded-2xl bg-surface-raised p-4 shadow-4"
    >
      <div className="flex items-start gap-2">
        <div className="grid flex-1 gap-0.5">
          <span className="flex items-center gap-1.5">
            <LayerCode l="L1" />
            <h2 className="m-0 text-ui-lg text-text-primary">에이전트 핵심에 플러그인 더하기</h2>
          </span>
          <p className="m-0 text-ui-xs text-text-secondary">
            이 층 플러그인은 매 턴의 기본 동작(모델 · 도구 · 컨텍스트)을 바꿔요.
          </p>
        </div>
        <IconButton size="sm" variant="ghost" label="닫기" onClick={() => m.set({ overlay: null })}>
          <XIcon />
        </IconButton>
      </div>
      <div className="mt-2 grid h-[120px] place-items-center overflow-hidden rounded-xl bg-surface-base">
        <Art
          name="layer-stack-insert"
          label="내 블록을 에이전트 핵심(L1) 판의 빈 자리에 꽂는 그림"
          className="w-[118px]"
        />
      </div>
      <ol className="m-0 mt-3 flex list-none gap-1 p-0 text-ui-xs">
        {["가져오기", "검사·신뢰", "켜기"].map((s, i) => (
          <li
            key={s}
            className={`flex flex-1 items-center gap-1.5 rounded-md px-2 py-1 ${i === 0 ? "bg-surface-base text-text-primary" : "text-text-tertiary"}`}
          >
            <span className="font-mono text-mono-sm">{i + 1}</span>
            {s}
          </li>
        ))}
      </ol>
      <h3 className="m-0 mt-4 text-ui-sm text-text-primary">이 층에서 할 수 있는 것</h3>
      <ul className="m-0 mt-1.5 grid list-none gap-1.5 p-0">
        <Can ok code="registerProvider">
          모델 provider 등록
        </Can>
        <Can ok code="request.* · tool.*">
          요청·도구 지점에 훅
        </Can>
        <Can ok code="registerTool">
          도구 등록
        </Can>
        <Can ok={false} code="drive_requires_group">
          진행권은 그룹(L3)만
        </Can>
      </ul>
      <h3 className="m-0 mt-4 text-ui-sm text-text-primary">어디서 가져올까요</h3>
      <div className="mt-1.5 grid gap-1.5">
        <Source
          sel
          icon={<WandSparkles />}
          title="만들기 도우미로"
          tag="플러그인을 만드는 플러그인"
          line="원하는 걸 말하면 뼈대 · 검사 · 시험까지 해요"
        />
        <Source
          icon={<FolderOpen />}
          title="폴더에서"
          line=".fresnel-plugin/plugin.json 이 있는 폴더"
        />
        <Source
          icon={<SquareStack />}
          title="설치된 것 복제"
          line="모델 · 도구·권한 같은 내장을 고쳐 쓰기"
        />
      </div>
      <div className="flex-1" />
      <p className="m-0 mt-3 text-ui-xs text-text-tertiary">
        켜면 이번 단계가 끝나면 적용돼요. 안전 모드에서는 내 플러그인을 싣지 않아요.
      </p>
      <div className="mt-2 flex justify-end gap-1.5">
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
