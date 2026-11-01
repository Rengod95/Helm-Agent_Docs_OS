// O-12 새 시험(Sheet side="right", §6.31)과 N-30 개발 모드 켜기(Dialog).
// - 새 시험: 종류(시험 대화가 기본, replay·bench·코어 변경 검사는 배포 앱에서 "개발 모드에서만" 잠금), 대상, 프로필과 미리 보기
//   (profile.preview W-44, 실패하면 시작 잠금), 작업 폴더, 첫 메시지. 바닥: 비용 문장 → 누르면 확인 문장으로 바뀜(종료 코드 3과 같은 뜻).
// - 개발 모드: l3.authoring.devMode(범위 managed·user) + 저장소 경로. 켜기 전에 저장소의 시험 도구를 확인한다(authoring §6, §10 6번).
import {
  Alert,
  Button,
  Dialog,
  DialogClose,
  Field,
  Input,
  ListDescription,
  ListDescriptionRow,
  NumberField,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectOption,
  Sheet,
  Textarea,
} from "@caustic/react";
import type { ReactNode } from "react";
import {
  CircleCheck,
  CircleX,
  extName,
  FolderOpen,
  LoaderCircle,
  profiles,
  T,
  Terminal,
  TriangleAlert,
  josa,
} from "../../_shell";
import { DevLock, ExtName, Mono } from "../../_wb-c/parts";
import { goFolder } from "../../_wb-c/frame";
import type { DevDialog, NewKind, SheetStep } from "../flow";
import { REPO_OK } from "../flow";

const W = "w-[min(20rem,100%)]";

function KindRow({
  value,
  title,
  hint,
  locked,
  selected,
}: {
  value: NewKind;
  title: string;
  hint: string;
  locked: boolean;
  selected: boolean;
}) {
  return (
    <RadioGroupItem value={value} disabled={locked}>
      <span className="flex min-w-0 items-center gap-2 py-1">
        <span className="grid min-w-0 flex-1 gap-0">
          <span className={`text-ui-dense text-text-primary ${selected ? "font-semibold" : ""}`}>
            {title}
          </span>
          <span className="truncate text-ui-xs text-text-tertiary">{hint}</span>
        </span>
        {locked && (
          <DevLock
            reason={`배포 앱이라 잠겨 있어요. ${josa(T.devMode, "을", "를")} 켜면 고를 수 있어요.`}
          />
        )}
      </span>
    </RadioGroupItem>
  );
}

const PREVIEW: Record<string, { enable: string[]; settings: string; drive: string | null }> = {
  explore: {
    enable: ["helm", "learning", "web-exa"],
    settings: "ext.helm.maxLenses 4",
    drive: "helm",
  },
  quiet: { enable: ["learning"], settings: "없음", drive: null },
};

export function NewTrialSheet({
  step,
  kind,
  profile,
  previewFail,
  dev,
  onKind,
  onProfile,
  onStart,
  onConfirm,
  onBack,
  onClose,
}: {
  step: SheetStep;
  kind: NewKind;
  profile: string;
  previewFail: boolean;
  dev: boolean;
  onKind: (k: NewKind) => void;
  onProfile: (id: string) => void;
  onStart: () => void;
  onConfirm: () => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const busy = step === "starting" || step === "applying";
  const costly = kind === "trial";
  const p = PREVIEW[profile];
  let footer: ReactNode;
  if (step === "confirm")
    footer = (
      <>
        <p role="alert" className="m-0 min-w-0 flex-1 text-ui-sm text-text-primary">
          모델 토큰을 써서 {josa(T.trialThread, "을", "를")} 시작할까요?{" "}
          <span className="text-text-tertiary">예상 40k · 약 $0.12</span>
        </p>
        <Button size="sm" tone="neutral" variant="ghost" onClick={onBack}>
          돌아가기
        </Button>
        <Button size="sm" tone="accent" variant="solid" onClick={onConfirm} autoFocus>
          토큰 쓰고 시작
        </Button>
      </>
    );
  else if (busy)
    footer = (
      <span
        role="status"
        className="inline-flex min-w-0 flex-1 items-center gap-2 text-ui-sm text-text-secondary"
      >
        <LoaderCircle aria-hidden className="size-icon-sm animate-spin" />
        {step === "starting"
          ? `${T.profile} 적용 중 · 이 ${T.thread}에만`
          : `${T.trialThread} 만드는 중`}
      </span>
    );
  else
    footer = (
      <>
        <span className="min-w-0 flex-1 text-ui-xs text-text-tertiary">
          {costly ? "모델 토큰을 써요 · 예상 40k" : "토큰을 쓰지 않아요"}
        </span>
        <Button size="sm" tone="neutral" variant="ghost" onClick={onClose}>
          취소
        </Button>
        <Button size="sm" tone="accent" variant="solid" disabled={previewFail} onClick={onStart}>
          시작
        </Button>
      </>
    );

  return (
    <Sheet
      side="right"
      size="sm"
      open={step !== "closed"}
      onOpenChange={(o: boolean) => (!o && !busy ? onClose() : undefined)}
      title="새 시험"
      closeLabel="닫기"
      footer={footer}
    >
      <fieldset
        disabled={busy || step === "confirm"}
        className="m-0 grid min-w-0 gap-4 border-0 p-0"
      >
        <Field label="종류" group>
          <RadioGroup
            size="sm"
            value={kind}
            onValueChange={(v) => onKind(v as NewKind)}
            aria-label="시험 종류"
            className="gap-0"
          >
            <KindRow
              value="trial"
              title={T.trialThread}
              hint={`${josa(T.profile, "을", "를")} 적용한 새 ${T.thread}에서 대상을 돌려요`}
              locked={false}
              selected={kind === "trial"}
            />
            <KindRow
              value="replay"
              title={T.replay}
              hint="기록한 대화를 커밋 지점마다 끊어 다시 돌려요"
              locked={!dev}
              selected={kind === "replay"}
            />
            <KindRow
              value="bench"
              title={T.bench}
              hint="확장 디스패치와 진행권 교대 시간을 재요"
              locked={!dev}
              selected={kind === "bench"}
            />
            <KindRow
              value="diff"
              title={T.coreDiff}
              hint="보호 경로의 바뀐 줄을 세요"
              locked={!dev}
              selected={kind === "diff"}
            />
          </RadioGroup>
        </Field>

        {kind === "trial" && (
          <>
            <Field label="대상" hint={`${josa(T.lead, "을", "를")} 쓰는 ${T.group}`}>
              <Select size="xs" defaultValue="helm" className={W}>
                {["helm", "review", "authoring"].map((id) => (
                  <SelectOption key={id} value={id}>
                    {extName(id)}
                  </SelectOption>
                ))}
              </Select>
            </Field>
            <Field label={T.profile}>
              <Select size="xs" value={profile} onValueChange={onProfile} className={W}>
                {profiles.map((x) => (
                  <SelectOption key={x.id} value={x.id}>
                    {x.title}
                  </SelectOption>
                ))}
              </Select>
            </Field>
            {previewFail ? (
              <Alert
                tone="danger"
                layout="inline"
                size="sm"
                emphasis="lead"
                action={
                  <Button
                    size="xs"
                    tone="neutral"
                    variant="outline"
                    onClick={() => goFolder("c03-ext-list")}
                  >
                    확장 열기
                  </Button>
                }
              >
                <b>{`${josa(T.profile, "을", "를")} 미리 보지 못했어요.`}</b>{" "}
                {`${josa(extName("review"), "이", "가")} ${josa(T.autoDisabled, "이라", "라")} 켤 수 없어요. 다시 켜거나 다른 ${josa(T.profile, "을", "를")} 골라요.`}{" "}
                <Mono>profile.preview · ext_auto_disabled</Mono>
              </Alert>
            ) : (
              p !== undefined && (
                <section aria-label="적용하면" className="grid gap-0.5">
                  <p className="m-0 text-ui-xs text-text-tertiary">이 {T.thread}에 적용하면</p>
                  <ListDescription
                    variant="ghost"
                    size="xs"
                    aria-label="적용하면"
                    className="rounded-none [--cs-size-list-term:5.5rem] [&_[data-slot=list-description-row]]:px-0"
                  >
                    <ListDescriptionRow term="켜기">
                      <span className="inline-flex flex-wrap gap-x-2">
                        {p.enable.map((id) => (
                          <ExtName key={id} id={id} showId={false} />
                        ))}
                      </span>
                    </ListDescriptionRow>
                    <ListDescriptionRow term="설정">
                      <Mono dim={false}>{p.settings}</Mono>
                    </ListDescriptionRow>
                    <ListDescriptionRow term={`${T.drive} ${T.group}`}>
                      {p.drive === null ? "자동" : extName(p.drive)}
                    </ListDescriptionRow>
                  </ListDescription>
                </section>
              )
            )}
            <Field label="작업 폴더">
              <Input
                size="xs"
                defaultValue="~/code/xeon"
                className="font-mono"
                containerClassName={W}
              />
            </Field>
            <Field label="첫 메시지">
              <Textarea
                size="sm"
                rows={3}
                defaultValue="무효화 시험이 계속 실패해. 원인 후보를 렌즈 5개로 넓게 봐줘."
              />
            </Field>
          </>
        )}
        {kind === "replay" && (
          <>
            <Field label="기록">
              <Select size="xs" defaultValue="t1" className={W}>
                <SelectOption value="t1">캐시 무효화 조사 · 턴 1–9</SelectOption>
              </Select>
            </Field>
            <NumberField
              size="xs"
              label="커밋 상한"
              defaultValue={200}
              min={1}
              max={1000}
              containerClassName="w-36"
            />
          </>
        )}
        {kind === "bench" && (
          <NumberField
            size="xs"
            label="반복"
            defaultValue={5}
            min={1}
            max={50}
            containerClassName="w-36"
          />
        )}
        {kind === "diff" && (
          <Field label="기준">
            <Input size="xs" defaultValue="main" className="font-mono" containerClassName={W} />
          </Field>
        )}
      </fieldset>
    </Sheet>
  );
}

const CHECKS = [
  "scripts/bench-server.ts",
  "scripts/core-diff-check.ts",
  "packages/group-kit/src/testing/replay",
];

export function DevModeDialog({
  state,
  repo,
  onRepo,
  onCheck,
  onClose,
}: {
  state: DevDialog;
  repo: string;
  onRepo: (p: string) => void;
  onCheck: () => void;
  onClose: () => void;
}) {
  const checking = state === "checking";
  const bad = state === "norepo";
  return (
    <Dialog
      size="sm"
      open={state !== "closed"}
      onOpenChange={(o: boolean) => (!o && !checking ? onClose() : undefined)}
      icon={<Terminal />}
      title={`${T.devMode} 켜기`}
      description={`저장소의 시험 도구로 ${T.replay}, ${T.bench}, ${josa(T.coreDiff, "을", "를")} 돌려요. 모델 토큰은 쓰지 않아요.`}
      footer={
        <>
          <DialogClose asChild>
            <Button size="sm" tone="neutral" variant="outline" disabled={checking}>
              취소
            </Button>
          </DialogClose>
          <Button
            size="sm"
            tone="neutral"
            variant="solid"
            disabled={checking || bad}
            onClick={onCheck}
          >
            {checking ? "확인 중" : "켜기"}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field
          label={T.repoPath}
          {...(bad
            ? { error: "이 폴더에 시험 도구가 없어요 · scripts/core-diff-check.ts 없음" }
            : { hint: "xeon 저장소를 내려받은 폴더예요" })}
        >
          <div className="flex items-center gap-1.5">
            <Input
              size="xs"
              value={repo}
              onChange={(e: { currentTarget: { value: string } }) => onRepo(e.currentTarget.value)}
              className="font-mono"
              containerClassName="min-w-0 flex-1"
            />
            <Button
              size="xs"
              tone="neutral"
              variant="outline"
              iconStart={<FolderOpen />}
              disabled={checking}
            >
              고르기
            </Button>
          </div>
        </Field>
        {bad && (
          <p className="m-0 flex items-center gap-2 text-ui-sm text-text-secondary">
            <TriangleAlert aria-hidden emphasis="muted" className="size-icon-sm" />
            이 컴퓨터에서 찾은 저장소 <Mono dim={false}>{REPO_OK}</Mono>
            <Button size="xs" tone="neutral" variant="ghost" onClick={() => onRepo(REPO_OK)}>
              이걸로
            </Button>
          </p>
        )}
        {checking && (
          <ul aria-label="확인하는 파일" className="m-0 grid list-none gap-0.5 p-0">
            {CHECKS.map((c, i) => (
              <li key={c} className="flex items-center gap-2 text-ui-dense text-text-secondary">
                {i < 2 ? (
                  <CircleCheck aria-hidden emphasis="muted" className="size-icon-sm" />
                ) : (
                  <LoaderCircle
                    aria-hidden
                    className="size-icon-sm animate-spin text-text-tertiary"
                  />
                )}
                <Mono dim={false}>{c}</Mono>
              </li>
            ))}
          </ul>
        )}
        {bad && (
          <ul aria-label="확인한 파일" className="m-0 grid list-none gap-0.5 p-0">
            {CHECKS.map((c, i) => (
              <li key={c} className="flex items-center gap-2 text-ui-dense text-text-secondary">
                {i === 0 ? (
                  <CircleCheck aria-hidden emphasis="muted" className="size-icon-sm" />
                ) : (
                  <CircleX aria-hidden emphasis="muted" className="size-icon-sm" />
                )}
                <Mono dim={false}>{c}</Mono>
              </li>
            ))}
          </ul>
        )}
        <ListDescription
          variant="ghost"
          size="xs"
          aria-label="설정"
          className="rounded-none [--cs-size-list-term:5rem] [&_[data-slot=list-description-row]]:px-0"
        >
          <ListDescriptionRow term="설정 키">
            <Mono>l3.authoring.devMode</Mono>
          </ListDescriptionRow>
          <ListDescriptionRow term="범위">이 컴퓨터 사용자 · 바로 적용</ListDescriptionRow>
        </ListDescription>
      </div>
    </Dialog>
  );
}
