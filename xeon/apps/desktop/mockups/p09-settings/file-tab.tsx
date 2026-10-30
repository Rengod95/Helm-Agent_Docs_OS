// S8 파일로 보기: 오른쪽 well "사용자 설정 파일" 탭. settings.readFile → Textarea 편집 → writeFile { baseSha256 }.
// 충돌(3107)이면 위에 경고와 다시 읽기. 코드 편집기는 caustic에 없어(C-06) mono Textarea로 대신한다.
import { Alert, Button, SegmentedControl, SegmentedControlItem, Textarea } from "@caustic/react";

const TEXT = `{
  "l1": {
    "models": {
      "default": "anthropic/claude-sonnet-5-5",
      "reasoning": "high",
      "fallbackChain": ["claude-sonnet-5-5", "claude-haiku-5-5"]
    },
    "engine": { "maxConcurrentTurns": 4 }
  },
  "l2": {
    "web": { "search": { "order": ["searxng", "builtin", "exa", "brave"] } }
  }
}`;

export function FileTab() {
  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2">
        <SegmentedControl size="xs" aria-label="범위" defaultValue="user">
          <SegmentedControlItem value="user">사용자</SegmentedControlItem>
          <SegmentedControlItem value="project">프로젝트</SegmentedControlItem>
        </SegmentedControl>
        <span className="min-w-0 truncate font-mono text-mono-sm text-text-tertiary">
          ~/.xeon/settings.json
        </span>
      </div>
      <Alert
        tone="warning"
        layout="inline"
        action={
          <Button size="xs" tone="neutral" variant="outline">
            다시 읽기
          </Button>
        }
      >
        다른 곳에서 바뀌었어요. 다시 읽은 뒤 저장해 주세요.
      </Alert>
      <Textarea
        aria-label="사용자 설정 파일"
        defaultValue={TEXT}
        spellCheck={false}
        rows={16}
        wrap="off"
        className="font-mono text-mono-sm"
      />
      <div className="flex justify-end gap-1">
        <Button size="xs" tone="neutral" variant="ghost">
          되돌리기
        </Button>
        <Button size="xs" tone="neutral" variant="solid" disabled>
          저장
        </Button>
      </div>
    </div>
  );
}
