// O-07 새 대화: 작업 폴더를 고르고 thread.create { workspace? }. P-01 "대화 시작"과 ⌘N이 같은 부품을 연다.
// 폴더 입력은 checkWorkspaceInput 규칙(비면 폴더 없음, 절대 경로만)을 따른다. OS 폴더 고르기는 [gap:W-19]라 버튼은 그려 두되 목업에서는 아무것도 안 한다.
// 최근 폴더는 selectRecentWorkspaces 대용 고정 데이터. 첫 실행이면 비어 있다.
import {
  Alert,
  Button,
  Dialog,
  Field,
  IconButton,
  Input,
  ListNavigation,
  ListNavigationGroup,
  ListNavigationItem,
} from "@caustic/react";
import { useState } from "react";
import { Folder, FolderOpen } from "../_shell";

export interface RecentWorkspace {
  /** 보내는 값(절대 경로) */
  path: string;
  /** 보이는 값(~ 줄임) */
  label: string;
  meta: string;
}

export const recentWorkspaces: RecentWorkspace[] = [
  { path: "/Users/mina/code/fresnel", label: "~/code/fresnel", meta: "대화 4" },
  { path: "/Users/mina/notes", label: "~/notes", meta: "대화 3" },
  { path: "/Users/mina/code/caustic", label: "~/code/caustic", meta: "지난주" },
];

const ABSOLUTE = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/;
function hintOf(text: string): string | null {
  const t = text.trim();
  if (t === "" || ABSOLUTE.test(t)) return null;
  return "절대 경로로 적어 주세요. 예: /Users/mina/project";
}

export interface NewThreadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recent: RecentWorkspace[];
  initialPath?: string;
  /** 호스트가 폴더를 거절했을 때(-32602) 보일 상태로 시작 */
  rejected?: boolean;
  /** 만드는 중으로 시작 */
  creating?: boolean;
  onCreate?: (path: string) => void;
}

export function NewThreadDialog({
  open,
  onOpenChange,
  recent,
  initialPath,
  rejected = false,
  creating = false,
  onCreate,
}: NewThreadDialogProps) {
  const [path, setPath] = useState(initialPath ?? recent[0]?.path ?? "");
  const [touched, setTouched] = useState(initialPath !== undefined);
  const [busy, setBusy] = useState(creating);
  const [failed, setFailed] = useState(rejected);
  const hint = touched ? hintOf(path) : null;
  const create = () => {
    if (hintOf(path) !== null) return setTouched(true);
    setBusy(true);
    window.setTimeout(() => {
      setBusy(false);
      onOpenChange(false);
      onCreate?.(path.trim());
    }, 700);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title="새 대화"
      footer={
        <>
          <span aria-hidden className="flex-1" />
          <Button size="sm" tone="neutral" variant="ghost" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button
            size="sm"
            tone="neutral"
            variant="solid"
            loading={busy}
            disabled={hint !== null}
            onClick={create}
          >
            {path.trim() === "" ? "폴더 없이 만들기" : "만들기"}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        {failed && (
          <Alert tone="danger" layout="inline" size="sm">
            작업 폴더를 열 수 없어요. 있는 폴더의 절대 경로인지 확인해 주세요.
          </Alert>
        )}
        <Field
          label="작업 폴더"
          optional
          optionalLabel="(선택)"
          error={hint ?? undefined}
          size="sm"
        >
          <Input
            size="sm"
            value={path}
            invalid={hint !== null}
            spellCheck={false}
            autoComplete="off"
            placeholder="/Users/mina/project"
            className="font-mono text-mono-sm"
            onValueChange={(v) => {
              setPath(v);
              setTouched(true);
              setFailed(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") create();
            }}
            suffix={
              <IconButton size="xs" variant="ghost" label="폴더 고르기">
                <FolderOpen />
              </IconButton>
            }
          />
        </Field>
        {recent.length > 0 ? (
          <ListNavigation aria-label="최근 작업 폴더" kind="navigation" size="sm" as="div">
            <ListNavigationGroup heading="최근">
              {recent.map((w) => (
                <ListNavigationItem
                  key={w.path}
                  icon={<Folder />}
                  current={path.trim() === w.path}
                  meta={w.meta}
                  onSelect={() => {
                    setPath(w.path);
                    setTouched(true);
                    setFailed(false);
                  }}
                >
                  <span className="font-mono text-mono-sm">{w.label}</span>
                </ListNavigationItem>
              ))}
            </ListNavigationGroup>
          </ListNavigation>
        ) : (
          path.trim() === "" && (
            <p className="m-0 text-ui-sm text-text-tertiary">
              비워 두면 프로젝트 설정 없이 홈 기준으로 시작해요.
            </p>
          )
        )}
      </div>
    </Dialog>
  );
}
