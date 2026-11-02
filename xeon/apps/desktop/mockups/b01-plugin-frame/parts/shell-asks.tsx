// 플러그인 화면이 셸에게 맡기는 묻기 셋(ADR-0021 §3.4, §3.6.6). 모두 셸 층이라 플러그인이 흉내 낼 수 없다.
// - ExtApprovalCard: requestApproval과 approval:true 메서드가 만든 표준 승인 카드(ADR-0018). 출처는 ext:<id>와 표시 이름(DP-33).
//   승인 기억은 요청 단위만(결정 7)이라 "항상" 단추가 없다.
// - LinkDialog: navigate 외부 링크 확인. 데스크톱은 OS 브라우저, 웹은 새 탭.
// - FramesSettingDialog: 프레임 금지(frame_blocked) 자리에서 "설정 열기"를 누르면 뜨는 설정 한 줄(P-09 플러그인 탭의 같은 행).
import {
  AgentRequest,
  Button,
  Dialog,
  DialogClose,
  ListDescription,
  ListDescriptionRow,
  Switch,
} from "@caustic/react";
import { Globe, josa, Settings, T } from "../../_shell";
import type { PluginExt } from "../data";

export const LIST_DESC =
  "rounded-none [&_[data-slot=list-description-row]]:px-0 [--cs-size-list-term:5.5rem]";

export function ExtApprovalCard({
  ext,
  status,
  at,
  thread,
  onDecide,
  flat = false,
}: {
  ext: PluginExt;
  status: "pending" | "allowed" | "denied";
  at: string;
  thread: string;
  onDecide: (d: "allowed" | "denied") => void;
  flat?: boolean;
}) {
  if (status !== "pending")
    return (
      <AgentRequest
        kind="permission"
        status={status}
        title={status === "allowed" ? "허용했어요" : "거부했어요"}
        subtitle={`작업 3개 맡기기 · ext:${ext.name}`}
      />
    );
  return (
    <AgentRequest
      kind="permission"
      title={`${josa(ext.display, "이", "가")} 승인을 구해요`}
      subtitle={`${thread} · ${at} · ext:${ext.name}`}
      shadow="none"
      {...(flat ? { variant: "ghost" as const } : {})}
      className={flat ? "px-0 py-0" : "shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)]"}
      actions={[
        { id: "deny", label: "거부", tone: "danger" },
        { id: "once", label: "허용", tone: "primary" },
      ]}
      onAction={(id) => onDecide(id === "once" ? "allowed" : "denied")}
    >
      <ListDescription variant="ghost" size="xs" aria-label="승인 상세" className={LIST_DESC}>
        <ListDescriptionRow term="요청">대기 작업 3개를 {T.childAgent}에 맡기기</ListDescriptionRow>
        <ListDescriptionRow term="동작" mono>
          ext.{ext.name}.dispatch
        </ListDescriptionRow>
        <ListDescriptionRow term="작업" mono>
          t13, t14, t15
        </ListDescriptionRow>
        <ListDescriptionRow term="보낸 화면">
          {ext.display} <span className="text-text-tertiary">· {T.viewFrame}</span>
        </ListDescriptionRow>
      </ListDescription>
    </AgentRequest>
  );
}

export function LinkDialog({
  ext,
  url,
  web,
  open,
  onOpenChange,
  onOpenLink,
}: {
  ext: PluginExt;
  url: string;
  web: boolean;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onOpenLink: () => void;
}) {
  return (
    <Dialog
      kind="alert"
      size="sm"
      open={open}
      onOpenChange={onOpenChange}
      icon={<Globe />}
      title="외부 링크를 열까요?"
      description={`${josa(ext.display, "이", "가")} 앱 밖 주소를 열려고 해요.`}
      footer={
        <>
          <span aria-hidden className="flex-1" />
          <DialogClose asChild>
            <Button size="sm" tone="neutral" variant="outline" autoFocus>
              취소
            </Button>
          </DialogClose>
          <Button size="sm" tone="neutral" variant="solid" onClick={onOpenLink}>
            {web ? "새 탭에서 열기" : "브라우저에서 열기"}
          </Button>
        </>
      }
    >
      <p className="m-0 break-all rounded-lg bg-neutral-track px-3 py-2 font-mono text-mono-sm text-text-primary">
        {url}
      </p>
    </Dialog>
  );
}

export function FramesSettingDialog({
  open,
  onOpenChange,
  on,
  onToggle,
  project = false,
  projectOn = false,
  onToggleProject,
  locked = false,
  projectTrust = "allow",
  onTrustFolder,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  on: boolean;
  onToggle: (v: boolean) => void;
  /** 프로젝트 확장 화면에서 열었으면 둘째 행(allowProjectFrames, 사용자 범위만)을 보인다(N-26). */
  project?: boolean;
  projectOn?: boolean;
  onToggleProject?: (v: boolean) => void;
  /** 보안 확인(e2e) 전 빌드: 설정을 켤 수 없다(ADR-0021 §3.6.2 3번). */
  locked?: boolean;
  /** 이 폴더의 프로젝트 신뢰(O-04). allow가 아니면 프로젝트 확장이 실리지 않아 둘째 행이 잠긴다. */
  projectTrust?: "allow" | "undecided";
  onTrustFolder?: () => void;
}) {
  return (
    <Dialog
      size="sm"
      open={open}
      onOpenChange={onOpenChange}
      icon={<Settings />}
      title={`${T.pluginView} 설정`}
      closeLabel="닫기"
      showClose
      footer={
        <>
          <span className="text-ui-xs text-text-tertiary">설정 › 플러그인과 그룹에도 있어요</span>
          <span aria-hidden className="flex-1" />
          <DialogClose asChild>
            <Button size="sm" tone="neutral" variant="solid">
              닫기
            </Button>
          </DialogClose>
        </>
      }
    >
      <div className="grid gap-3">
        <label className="grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-0.5">
          <span className="text-ui-sm font-medium text-text-primary">{T.framesSetting}</span>
          <Switch
            size="sm"
            checked={on && !locked}
            disabled={locked}
            onCheckedChange={onToggle}
            className="row-span-2 self-center"
          />
          <span className="text-ui-xs text-text-tertiary">
            {locked
              ? "이 앱 버전은 격리 보안 확인을 마치기 전이라 켤 수 없어요. 확인을 마친 업데이트부터 켜져요. "
              : `확장이 낸 HTML·JS를 격리된 상자에서 돌려요. 끄면 ${T.viewFallback}이나 자리표시로 보여요. `}
            <span className="font-mono text-mono-sm">x.views.frames</span>
          </span>
        </label>
        {project ? (
          <label className="grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-0.5">
            <span className="text-ui-sm font-medium text-text-primary">
              {T.projectFramesSetting}
            </span>
            <Switch
              size="sm"
              checked={projectOn}
              disabled={!on || locked || projectTrust !== "allow"}
              onCheckedChange={(v) => onToggleProject?.(v)}
              className="row-span-2 self-center"
            />
            <span className="text-ui-xs text-text-tertiary">
              모든 프로젝트의 확장에 적용돼요. 사용자 설정에만 저장하고 프로젝트 설정 파일로는 켤 수
              없어요. <span className="font-mono text-mono-sm">x.views.allowProjectFrames</span>
            </span>
          </label>
        ) : null}
        {project && (
          // N-26 동의 조건 두 줄: 폴더 신뢰(O-04 allow)가 먼저, 그다음 사용자 범위 설정. 둘 다 있어야 프레임이 뜬다.
          <ListDescription variant="ghost" size="xs" aria-label="켜는 조건" className={LIST_DESC}>
            <ListDescriptionRow term={T.projectTrust}>
              {projectTrust === "allow" ? (
                <span>
                  허용함{" "}
                  <span className="font-mono text-mono-sm text-text-tertiary">~/code/fresnel</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-2">
                  아직 정하지 않았어요
                  <Button size="xs" tone="neutral" variant="outline" onClick={onTrustFolder}>
                    이 폴더 신뢰…
                  </Button>
                </span>
              )}
            </ListDescriptionRow>
            <ListDescriptionRow term="저장 범위">
              사용자 설정 · 이 기기의 모든 프로젝트
            </ListDescriptionRow>
          </ListDescription>
        )}
        {!project && (
          <p className="m-0 text-ui-xs text-text-tertiary">
            {T.trustProject} {josa(T.extension, "은", "는")} 이 설정과 따로{" "}
            {josa(T.projectFramesSetting, "을", "를")} 켜야 해요.
          </p>
        )}
      </div>
    </Dialog>
  );
}
