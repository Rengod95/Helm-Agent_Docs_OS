// W9 만들기(P-22): Stepper 세 단계(종류, 이름, 확인) + 결과. 결과는 단계가 아니라 다 끝난 뒤 같은 자리에 보인다.
// 만들기 wire(ext.scaffold [gap:W-27])가 없을 때의 대안 "터미널 명령 복사"를 확인 단계에 같이 둔다.
import {
  Badge,
  Button,
  Field,
  Input,
  ListDescription,
  ListDescriptionRow,
  Stepper,
} from "@caustic/react";
import {
  CircleCheck,
  ToneIcon,
  RotateCcw,
  Copy,
  FileCode,
  FlaskConical,
  FolderOpen,
  Link,
} from "../../_shell";
import { RadioList } from "../parts/radio-list";
import { ScreenHead, SectionTitle, WB_WIDTH } from "../parts/screen-head";
import { NAME_RULE, driveFiles, installedNames, reservedNames, templates } from "../fixtures";
import { useMock, type CreateStep } from "../store";
import { useState } from "react";

function nameError(name: string): string | null {
  if (name === "") return "이름을 넣어 주세요";
  if (!NAME_RULE.test(name)) return "소문자로 시작하고 소문자, 숫자, 하이픈만 쓸 수 있어요(2~32자)";
  if (reservedNames.includes(name)) return `${name}은 예약 이름이라 쓸 수 없어요`;
  if (installedNames.includes(name)) return `${name} 확장이 이미 있어요`;
  return null;
}

export function CreateScreen() {
  const m = useMock();
  const [kind, setKind] = useState("drive");
  const tpl = templates.find((t) => t.id === kind);
  const files = "files" in (tpl ?? {}) ? (tpl as { files: number }).files : 0;
  const flag = "flag" in (tpl ?? {}) ? (tpl as { flag: string }).flag : "";
  const err = nameError(m.name);
  const folder = `~/code/groups/${m.name}`;
  const step = m.createStep;
  const go = (s: CreateStep) => m.set({ createStep: s });
  const cli = `fresnel group new ${m.name}${flag ? ` ${flag}` : ""}`;

  return (
    <>
      <ScreenHead title="만들기" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={`${WB_WIDTH} grid gap-5 pb-6`}>
          <Stepper
            aria-label="만들기 단계"
            size="sm"
            value={step + 1}
            steps={[
              { label: "종류", description: step > 0 ? tpl?.label : undefined },
              { label: "이름", description: step > 1 ? m.name : undefined },
              { label: "확인", description: step > 2 ? "만듦" : undefined },
            ]}
            className="max-w-[32rem] px-2"
          />

          {step === 0 && (
            <section aria-labelledby="c-kind" className="grid max-w-[36rem] gap-3">
              <h2 id="c-kind" className="sr-only">
                종류
              </h2>
              <div className="px-2">
                <RadioList
                  labelledBy="c-kind"
                  value={kind}
                  onValueChange={setKind}
                  rows={templates.map((t) => ({
                    value: t.id,
                    disabled: "disabled" in t && t.disabled,
                    title: (
                      <span className="inline-flex items-center gap-1.5">
                        {t.label}
                        {"disabled" in t && t.disabled && (
                          <Badge size="xs" tone="neutral">
                            준비 중
                          </Badge>
                        )}
                      </span>
                    ),
                    hint: "files" in t ? `${t.hint} · 파일 ${t.files}개` : t.hint,
                  }))}
                />
              </div>
              <div className="flex gap-1.5 px-2">
                <Button size="sm" tone="accent" variant="solid" onClick={() => go(1)}>
                  다음
                </Button>
              </div>
            </section>
          )}

          {step === 1 && (
            <section aria-labelledby="c-name" className="grid max-w-[36rem] gap-3 px-2">
              <h2 id="c-name" className="sr-only">
                이름과 폴더
              </h2>
              <Field
                label="이름"
                error={err ?? undefined}
                hint="확장 id가 돼요. 이벤트 kind는 grp.<이름>.*"
              >
                <Input
                  size="xs"
                  value={m.name}
                  onValueChange={(v) => m.set({ name: v })}
                  className="font-mono"
                  containerClassName="w-[min(20rem,100%)]"
                />
              </Field>
              <Field label="폴더" hint="없거나 비어 있는 폴더여야 해요">
                <div className="flex items-center gap-1.5">
                  <Input
                    size="xs"
                    value={folder}
                    readOnly
                    className="font-mono"
                    containerClassName="w-[min(20rem,100%)]"
                  />
                  <Button size="md" variant="soft" iconStart={<FolderOpen />}>
                    고르기
                  </Button>
                </div>
              </Field>
              <div className="flex gap-1.5">
                <Button size="sm" variant="ghost" onClick={() => go(0)}>
                  이전
                </Button>
                <Button
                  size="sm"
                  tone="accent"
                  variant="solid"
                  disabled={err !== null}
                  onClick={() => go(2)}
                >
                  다음
                </Button>
              </div>
            </section>
          )}

          {step === 2 && (
            <section aria-labelledby="c-confirm" className="grid max-w-[44rem] gap-4">
              <h2 id="c-confirm" className="sr-only">
                확인
              </h2>
              <ListDescription variant="ghost" size="xs" aria-label="만들 확장" className="px-2">
                <ListDescriptionRow term="종류">{tpl?.label}</ListDescriptionRow>
                <ListDescriptionRow term="이름" mono>
                  {m.name}
                </ListDescriptionRow>
                <ListDescriptionRow term="폴더" mono>
                  {folder}
                </ListDescriptionRow>
                <ListDescriptionRow term="버전" mono>
                  0.1.0
                </ListDescriptionRow>
              </ListDescription>
              <div>
                <SectionTitle meta="만든 뒤 매니페스트를 검사하고, 실패하면 만든 파일을 지워요">
                  만들 파일 {files}개
                </SectionTitle>
                <ul className="m-0 grid list-none gap-0 p-0">
                  {driveFiles.map((f) => (
                    <li
                      key={f.path}
                      className="flex h-7 min-w-0 items-center gap-2 px-2 text-ui-dense"
                    >
                      <FileCode
                        aria-hidden
                        emphasis="muted"
                        className="size-icon-xs shrink-0 text-text-tertiary"
                      />
                      <span className="min-w-0 truncate font-mono text-mono-sm text-text-primary">
                        {f.path}
                      </span>
                      {f.note && (
                        <span className="truncate text-ui-xs text-text-tertiary">{f.note}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 px-2">
                <Button size="sm" variant="ghost" onClick={() => go(1)}>
                  이전
                </Button>
                <Button size="sm" tone="accent" variant="solid" onClick={() => go(3)}>
                  만들기
                </Button>
                <span className="ms-auto inline-flex min-w-0 items-center gap-1.5">
                  <code className="truncate font-mono text-mono-sm text-text-tertiary">{cli}</code>
                  <Button
                    size="sm"
                    variant="ghost"
                    iconStart={<Copy />}
                    onClick={() => m.notify("터미널 명령을 복사했어요")}
                  >
                    명령 복사
                  </Button>
                </span>
              </div>
            </section>
          )}

          {step === 3 && (
            <section aria-labelledby="c-done" className="grid max-w-[44rem] gap-4">
              <div className="flex items-center gap-2 px-2">
                <ToneIcon tone="success">
                  <CircleCheck />
                </ToneIcon>
                <h2 id="c-done" className="m-0 text-ui-strong font-semibold text-text-primary">
                  {m.name}을 만들었어요
                </h2>
                <span className="font-mono text-mono-sm text-text-tertiary">{folder}</span>
              </div>
              <ListDescription variant="ghost" size="xs" aria-label="검사 결과" className="px-2">
                <ListDescriptionRow term="매니페스트">문제 0 · validateManifest</ListDescriptionRow>
                <ListDescriptionRow term="drive 소스">경고 0 · scanDriveSource</ListDescriptionRow>
                <ListDescriptionRow term="코어 변경">보호 경로 0줄</ListDescriptionRow>
                <ListDescriptionRow term="상태">
                  아직 연결 안 함 · 확장 목록에 없어요
                </ListDescriptionRow>
              </ListDescription>
              <div className="grid gap-1 px-2">
                <span className="text-ui-xs text-text-tertiary">다음</span>
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    size="sm"
                    variant="soft"
                    iconStart={<FileCode />}
                    onClick={() => m.notify("편집기에서 열어요")}
                  >
                    편집기에서 열기
                  </Button>
                  <Button
                    size="sm"
                    variant="soft"
                    iconStart={<Link />}
                    onClick={() => m.notify("사용자 확장 위치에 연결했어요 · 꺼진 채로")}
                  >
                    사용자 확장 위치에 연결
                  </Button>
                  <Button
                    size="sm"
                    variant="soft"
                    iconStart={<FlaskConical />}
                    onClick={() => m.notify("테스트 대화를 만들고 그 대화에서만 켰어요")}
                  >
                    테스트 대화에서 켜기
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    iconStart={<RotateCcw />}
                    onClick={() => m.set({ screen: "tests", newTrialOpen: true })}
                  >
                    replay 테스트
                  </Button>
                </div>
                <p className="m-0 pt-1 text-ui-xs text-text-tertiary">
                  처음 켤 때 신뢰 확인을 거쳐요. 저장하면 다시 실려요.
                </p>
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
