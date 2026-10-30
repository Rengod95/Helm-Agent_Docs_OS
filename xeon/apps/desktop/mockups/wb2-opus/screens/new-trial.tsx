// O-12 새 시험(Sheet side="right", §6.31). 종류 → 대상 → 종류별 옵션. 비용이 드는 시험(bench --first-token, 시험 대화)은
// 시작 버튼 위에 확인 문장을 둔다(CLI 종료 코드 3과 같은 뜻). wire는 ext.test.run [gap:W-29] — 목업은 알림만.
import {
  Button,
  Checkbox,
  Field,
  Input,
  NumberField,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectOption,
  Sheet,
  Textarea,
} from "@caustic/react";
import { useState } from "react";
import { extensions, profiles } from "../fixtures";
import { useMock } from "../store";

type Kind = "replay" | "bench" | "trial" | "diff";

export function NewTrialSheet() {
  const m = useMock();
  const [kind, setKind] = useState<Kind>("replay");
  const [firstToken, setFirstToken] = useState(false);
  const drives = extensions.filter((e) => e.usesDrive);
  const costly = kind === "trial" || (kind === "bench" && firstToken);
  const close = () => m.set({ newTrialOpen: false });
  return (
    <Sheet
      side="right"
      size="sm"
      open={m.newTrialOpen}
      onOpenChange={(o: boolean) => m.set({ newTrialOpen: o })}
      title="새 시험"
      closeLabel="닫기"
      footer={
        <>
          <span className="min-w-0 flex-1 text-ui-xs text-text-tertiary">
            {costly ? "모델 토큰을 써요 · 예상 40k" : "토큰을 쓰지 않아요"}
          </span>
          <Button size="sm" variant="ghost" onClick={close}>
            취소
          </Button>
          <Button
            size="sm"
            tone="accent"
            variant="solid"
            onClick={() => {
              close();
              m.notify(kind === "trial" ? "시험 대화를 만들었어요" : "시험을 시작했어요");
            }}
          >
            {costly ? "토큰 쓰고 시작" : "시작"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="종류" group>
          <SegmentedControl
            size="sm"
            value={kind}
            onValueChange={(v) => setKind(v as Kind)}
            aria-label="시험 종류"
          >
            <SegmentedControlItem value="replay">replay</SegmentedControlItem>
            <SegmentedControlItem value="trial">시험 대화</SegmentedControlItem>
            <SegmentedControlItem value="bench">bench</SegmentedControlItem>
            <SegmentedControlItem value="diff">코어 변경</SegmentedControlItem>
          </SegmentedControl>
        </Field>

        {kind === "replay" && (
          <>
            <Field label="대상 그룹" hint="drive를 쓰는 확장만 재생할 수 있어요">
              <Select size="xs" defaultValue="review" className="w-[min(20rem,100%)]">
                {drives.map((e) => (
                  <SelectOption key={e.name} value={e.name}>
                    {e.name}
                  </SelectOption>
                ))}
              </Select>
            </Field>
            <Field label="테이프" hint="기록한 대화의 이벤트열을 기준 실행으로 써요">
              <Select size="xs" defaultValue="t1" className="w-[min(20rem,100%)]">
                <SelectOption value="t1">캐시 무효화 조사 · 턴 1–9</SelectOption>
                <SelectOption value="t2">테스트 정리 · 턴 1–4</SelectOption>
              </Select>
            </Field>
            <NumberField
              size="xs"
              label="커밋 상한"
              defaultValue={200}
              min={1}
              max={1000}
              className="w-36"
            />
          </>
        )}

        {kind === "trial" && (
          <>
            <Field label="프로필">
              <Select size="xs" defaultValue="explore" className="w-[min(20rem,100%)]">
                {profiles.map((p) => (
                  <SelectOption key={p.id} value={p.id}>
                    {p.title}
                  </SelectOption>
                ))}
              </Select>
            </Field>
            <Field label="작업 폴더">
              <Input
                size="xs"
                defaultValue="~/code/xeon"
                className="font-mono"
                containerClassName="w-[min(20rem,100%)]"
              />
            </Field>
            <Field label="첫 메시지">
              <Textarea
                size="sm"
                rows={3}
                defaultValue="무효화 시험이 계속 실패해. 원인 후보를 렌즈 5개로 찾아줘."
              />
            </Field>
          </>
        )}

        {kind === "bench" && (
          <>
            <Field label="묶음">
              <Select size="xs" defaultValue="server" className="w-[min(20rem,100%)]">
                <SelectOption value="server">서버(확장 디스패치, 임대 비용)</SelectOption>
              </Select>
            </Field>
            <NumberField
              size="xs"
              label="반복"
              defaultValue={5}
              min={1}
              max={50}
              className="w-36"
            />
            <label className="flex items-center gap-2 text-ui-dense text-text-primary">
              <Checkbox
                size="sm"
                checked={firstToken}
                onCheckedChange={(c) => setFirstToken(c === true)}
              />
              첫 토큰까지 시간도 재기
            </label>
          </>
        )}

        {kind === "diff" && (
          <Field
            label="기준"
            hint="보호 경로(contracts, ext-host, platform-*, core-*) 변경 줄을 세요"
          >
            <Input
              size="xs"
              defaultValue="main"
              className="font-mono"
              containerClassName="w-[min(20rem,100%)]"
            />
          </Field>
        )}
      </div>
    </Sheet>
  );
}
