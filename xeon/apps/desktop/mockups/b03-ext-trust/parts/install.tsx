// N-37 확장 가져오기: 고르기(폴더·묶음 파일) → 검사 → 설치 위치 → 이어서 신뢰 확인(O-10).
// 데스크톱은 OS 고르기 창, 웹은 묶음 파일 올리기 또는 원격 컴퓨터 경로. URL 설치는 "다음 단계" 안내만(coverage §4-12).
// 목업 전용: OS 고르기 창 대신 고를 폴더 둘(통과·실패)을 메뉴로 보인다.
import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogClose,
  FileUpload,
  Input,
  ListDescription,
  ListDescriptionRow,
  Menu,
  MenuItem,
  RadioGroup,
  RadioGroupItem,
  Skeleton,
} from "@caustic/react";
import { useState } from "react";
import {
  Check,
  CircleX,
  Folder,
  Link,
  LoaderCircle,
  Package,
  T,
  ToneIcon,
  josa,
} from "../../_shell";
import { CHECKS, FAILING, graphLens } from "../data";
import { LD, trustName } from "./bits";

export function InstallDialog({
  step,
  picked,
  checked,
  web,
  onPick,
  onNext,
  onRepick,
  onClose,
}: {
  step: "pick" | "checking" | "done";
  picked: null | "good" | "bad";
  checked: number;
  web: boolean;
  onPick: (p: "good" | "bad") => void;
  onNext: () => void;
  onRepick: () => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<"folder" | "bundle">(web ? "bundle" : "folder");
  const failed = step === "done" && picked === "bad";
  const fails = CHECKS.filter((c) => FAILING.has(c.id)).length;
  const source = picked === "bad" ? "~/Downloads/helm-fork/" : graphLens.source;
  return (
    <Dialog
      size="md"
      open
      onOpenChange={(o) => !o && onClose()}
      icon={<Package />}
      title={`${T.extension} ${T.install}`}
      description={
        step === "pick"
          ? `${T.installFolder}나 ${josa(T.installBundle, "을", "를")} 골라요. ${T.installCheck} 뒤 ${T.trustConfirm}로 이어져요.`
          : undefined
      }
      footer={
        <>
          <span aria-hidden className="flex-1" />
          <DialogClose asChild>
            <Button size="sm" tone="neutral" variant="outline" autoFocus>
              취소
            </Button>
          </DialogClose>
          {failed ? (
            <Button size="sm" tone="neutral" variant="solid" onClick={onRepick}>
              다른 {T.installFolder} 고르기
            </Button>
          ) : (
            <Button
              size="sm"
              tone="neutral"
              variant="solid"
              disabled={step !== "done"}
              onClick={onNext}
            >
              다음: {T.trustConfirm}
            </Button>
          )}
        </>
      }
    >
      {step === "pick" ? (
        <div className="grid gap-4">
          <RadioGroup
            aria-label="가져올 것"
            value={kind}
            onValueChange={(v) => setKind(v === "bundle" ? "bundle" : "folder")}
            size="sm"
            className="grid gap-2"
          >
            <RadioGroupItem value="folder" disabled={web}>
              <span className="grid">
                <span>{T.installFolder}</span>
                <span className="text-ui-xs text-text-tertiary">
                  <span className="font-mono text-mono-sm">.fresnel-plugin/plugin.json</span>이 있는{" "}
                  {T.installFolder}
                  {web ? " · 웹에서는 원격 컴퓨터 경로로" : ""}
                </span>
              </span>
            </RadioGroupItem>
            <RadioGroupItem value="bundle">
              <span className="grid">
                <span>{T.installBundle}</span>
                <span className="text-ui-xs text-text-tertiary">
                  {T.authoring} {T.extension}이 묶은 파일 하나
                </span>
              </span>
            </RadioGroupItem>
          </RadioGroup>
          {web ? (
            <div className="grid gap-2">
              <FileUpload
                size="sm"
                label={`${T.installBundle} 올리기`}
                browseLabel="파일 고르기"
                hint="여기에 끌어 놓거나 골라요 · 50MB까지"
                onFilesSelected={() => onPick("good")}
              />
              <div className="grid gap-1">
                <span className="text-ui-xs text-text-tertiary">
                  원격 컴퓨터의 {T.installFolder} 경로
                </span>
                <div className="flex gap-1.5">
                  <Input
                    size="sm"
                    aria-label="원격 경로"
                    placeholder="build-box:~/ext/graph-lens"
                    className="w-[20rem]"
                  />
                  <Button size="sm" tone="neutral" variant="outline" onClick={() => onPick("good")}>
                    {T.installCheck}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <Menu
              aria-label="목업: 고를 폴더"
              trigger={
                <Button
                  size="sm"
                  tone="neutral"
                  variant="outline"
                  iconStart={<Folder />}
                  className="justify-self-start"
                >
                  {kind === "folder" ? `${T.installFolder} 고르기…` : `${T.installBundle} 고르기…`}
                </Button>
              }
            >
              <MenuItem
                icon={<Folder />}
                end={<span className="text-ui-xs text-text-tertiary">통과</span>}
                onSelect={() => onPick("good")}
              >
                ~/Downloads/graph-lens/
              </MenuItem>
              <MenuItem
                icon={<Folder />}
                end={<span className="text-ui-xs text-text-tertiary">실패</span>}
                onSelect={() => onPick("bad")}
              >
                ~/Downloads/helm-fork/
              </MenuItem>
            </Menu>
          )}
          <div className="flex items-center gap-1.5 text-ui-xs text-text-tertiary">
            <Link emphasis="muted" aria-hidden className="size-icon-xs" />
            주소(URL)에서 {T.install}
            <Badge size="sm" tone="neutral">
              {T.nextStage}
            </Badge>
          </div>
        </div>
      ) : (
        <div className="grid gap-3">
          <ListDescription variant="ghost" size="xs" aria-label="고른 것" className={LD}>
            <ListDescriptionRow term="고른 것" mono>
              {source}
            </ListDescriptionRow>
            <ListDescriptionRow term={T.extension}>
              {picked === "bad" ? (
                <span>
                  Helm 포크 <span className="font-mono text-mono-sm text-text-tertiary">helm</span>{" "}
                  · 0.2.0-dev
                </span>
              ) : (
                <span>
                  {graphLens.display}{" "}
                  <span className="font-mono text-mono-sm text-text-tertiary">
                    {graphLens.name}
                  </span>{" "}
                  · {graphLens.version} · {graphLens.layer} {graphLens.kind}
                </span>
              )}
            </ListDescriptionRow>
          </ListDescription>
          {failed && (
            <Alert tone="danger" size="sm">
              {T.installCheck} {fails}개를 통과하지 못해 가져올 수 없어요 · 고친 뒤 다시 골라요
            </Alert>
          )}
          <ul aria-label={`${T.installCheck} 결과`} className="m-0 grid list-none gap-1.5 p-0">
            {CHECKS.map((c, i) => {
              const done = i < checked;
              const running = i === checked && step === "checking";
              const bad = picked === "bad" && FAILING.has(c.id);
              return (
                <li
                  key={c.id}
                  className="grid grid-cols-[1.25rem_8rem_minmax(0,1fr)] items-start gap-x-2 text-ui-dense"
                >
                  {done ? (
                    <ToneIcon tone={bad ? "danger" : "success"}>
                      {bad ? <CircleX /> : <Check />}
                    </ToneIcon>
                  ) : (
                    <ToneIcon tone="neutral">
                      {running ? <LoaderCircle className="animate-spin" /> : null}
                    </ToneIcon>
                  )}
                  <span className="text-text-primary">{c.label}</span>
                  {done ? (
                    <span className={bad ? "text-text-primary" : "text-text-secondary"}>
                      {bad ? c.fail : c.ok}
                      {bad && c.code !== undefined && (
                        <span className="ms-1.5 font-mono text-mono-sm text-text-tertiary">
                          {c.code}
                        </span>
                      )}
                    </span>
                  ) : running ? (
                    <Skeleton height={12} width="60%" className="mt-1" />
                  ) : (
                    <span />
                  )}
                </li>
              );
            })}
          </ul>
          {step === "done" && !failed && (
            <ListDescription variant="ghost" size="xs" aria-label="설치 위치" className={LD}>
              <ListDescriptionRow term="설치 위치">
                {T.installUserDir}{" "}
                <span className="font-mono text-mono-sm text-text-tertiary">{graphLens.dest}</span>
              </ListDescriptionRow>
              <ListDescriptionRow term={T.trustCeiling}>
                {trustName[graphLens.ceiling]}
              </ListDescriptionRow>
            </ListDescription>
          )}
        </div>
      )}
    </Dialog>
  );
}
