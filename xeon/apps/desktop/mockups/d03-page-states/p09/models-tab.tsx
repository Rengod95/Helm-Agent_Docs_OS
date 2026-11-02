// 모델 탭: 위젯 대응(§6.13) 견본. select 9개 이상 → Select, 8개 이하 → RadioGroup, number → NumberField, toggle → Switch,
// readonly 표 → ListDescription, 전용 편집기 fallbackChain → List reorderable(+ 이번 대화에만 적용).
import {
  Badge,
  Button,
  Checkbox,
  List,
  ListDescription,
  ListDescriptionRow,
  ListRow,
  NumberField,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectOption,
  Switch,
} from "@caustic/react";
import { SettingRow, SettingSection } from "../../_settings/row";
import { LockNote, reorderLabels, ShadowedScopes } from "../../_settings/parts";
import type { State } from "./app";

const MODELS = [
  "anthropic/claude-opus-5-5",
  "anthropic/claude-sonnet-5-5",
  "anthropic/claude-haiku-5-5",
  "openai/gpt-5.2",
  "openai/gpt-5.2-mini",
  "openrouter/deepseek-v4",
  "openrouter/qwen-3.5-coder",
  "ollama/llama-4-scout",
  "ollama/qwen-3.5-coder:32b",
];

export function ModelsTab({ state }: { state: State }) {
  const off = state === "S5";
  const draft = state === "S2";
  const err = state === "S3";
  const chain = draft
    ? ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"]
    : ["claude-sonnet-5-5", "claude-haiku-5-5"];
  return (
    <>
      <SettingSection title="기본">
        <SettingRow
          label="기본 모델"
          k="l1.models.default"
          scope="user"
          apply="now"
          disabled={off}
          flag={
            draft ? (
              <Badge size="sm" tone="info">
                다른 곳에서 바뀜
              </Badge>
            ) : undefined
          }
          warning={draft ? "다른 창이 claude-opus-5-5로 바꿨어요." : undefined}
          error={err ? "저장하지 못했어요. 엔진이 잠시 바빠요." : undefined}
          extra={
            draft ? (
              <div className="flex gap-1">
                <Button size="xs" tone="neutral" variant="outline">
                  그 값 쓰기
                </Button>
                <Button size="xs" tone="neutral" variant="ghost">
                  내 값 유지
                </Button>
              </div>
            ) : err ? (
              <div>
                <Button size="xs" tone="neutral" variant="outline">
                  다시 시도
                </Button>
              </div>
            ) : undefined
          }
        >
          <Select
            size="sm"
            aria-label="기본 모델"
            defaultValue="anthropic/claude-sonnet-5-5"
            disabled={off}
            invalid={err}
            className="w-80 max-w-full font-mono"
          >
            {MODELS.map((m) => (
              <SelectOption key={m} value={m}>
                <span className="font-mono text-mono-sm">{m}</span>
              </SelectOption>
            ))}
          </Select>
        </SettingRow>

        <SettingRow
          label="추론 레벨"
          k="l1.models.reasoning"
          scope="project"
          apply="nextTurn"
          saved={draft}
          disabled={off}
          extra={
            <ShadowedScopes
              defaultOpen={state === "S1"}
              disabled={off}
              rows={[{ scope: "사용자", value: "high", path: "~/.fresnel/settings.json" }]}
            />
          }
        >
          <RadioGroup
            aria-label="추론 레벨"
            orientation="horizontal"
            defaultValue={draft ? "high" : "medium"}
            disabled={off}
            className="min-h-7 gap-5"
          >
            <RadioGroupItem value="low">low</RadioGroupItem>
            <RadioGroupItem value="medium">medium</RadioGroupItem>
            <RadioGroupItem value="high">high</RadioGroupItem>
          </RadioGroup>
        </SettingRow>

        <SettingRow
          label="판정 최대 횟수"
          k="l1.agents.judge.maxRuns"
          scope="default"
          apply="nextTurn"
          disabled={off}
          error={err ? "1에서 20 사이여야 해요." : undefined}
        >
          <NumberField
            appearance="stepper"
            containerClassName="w-36"
            size="sm"
            aria-label="판정 최대 횟수"
            defaultValue={err ? 0 : 3}
            min={1}
            max={20}
            invalid={err}
            disabled={off}
          />
        </SettingRow>
      </SettingSection>

      <SettingSection title="라우팅">
        <SettingRow
          label="모델 역할"
          k="l1.models.roles"
          scope="managed"
          extra={<LockNote path="/etc/fresnel/managed.json" />}
        >
          <ListDescription
            variant="ghost"
            size="xs"
            aria-label="모델 역할"
            className="max-w-[28rem] rounded-none [--cs-size-list-term:7rem] [&_[data-slot=list-description-row]]:px-0"
          >
            <ListDescriptionRow term="기본" mono>
              claude-sonnet-5-5
            </ListDescriptionRow>
            <ListDescriptionRow term="판정" mono>
              claude-haiku-5-5
            </ListDescriptionRow>
            <ListDescriptionRow term="요약" mono>
              claude-haiku-5-5
            </ListDescriptionRow>
          </ListDescription>
        </SettingRow>

        <SettingRow
          label="폴백 체인"
          k="l1.models.fallbackChain"
          scope="user"
          apply="nextTurn"
          disabled={off}
          error={err ? "이 항목은 대화 범위에 쓸 수 없어요." : undefined}
          extra={
            <label className="flex w-fit items-center gap-2 text-ui-sm text-text-secondary">
              <Checkbox aria-label="이번 대화에만 적용" defaultChecked={err} disabled={off} />
              이번 대화(캐시 무효화 조사)에만 적용
            </label>
          }
        >
          <List
            {...reorderLabels}
            reorderable
            numbered
            size="xs"
            aria-label="폴백 체인"
            disabled={off}
            className="max-w-[28rem]"
          >
            {chain.map((m) => (
              <ListRow
                key={m}
                itemValue={m}
                title={<span className="font-mono text-mono-sm">{m}</span>}
                end={
                  draft && m === "claude-opus-5-5" ? (
                    <Badge size="sm" tone="neutral">
                      새로 넣음
                    </Badge>
                  ) : undefined
                }
              />
            ))}
          </List>
          <div>
            <Button size="xs" tone="neutral" variant="ghost" disabled={off}>
              모델 더하기
            </Button>
          </div>
        </SettingRow>
      </SettingSection>

      <SettingSection title="엔진">
        <SettingRow
          label="동시 턴"
          k="l1.engine.maxConcurrentTurns"
          scope="user"
          apply="restart"
          disabled={off}
        >
          <NumberField
            appearance="stepper"
            containerClassName="w-36"
            size="sm"
            aria-label="동시 턴"
            defaultValue={4}
            min={1}
            max={16}
            disabled={off}
          />
        </SettingRow>
        <SettingRow
          label="요청 제한 시간"
          k="l1.models.requestTimeoutMs"
          scope="default"
          apply="nextTurn"
          disabled={off}
        >
          <div className="flex items-center gap-2">
            <NumberField
              appearance="stepper"
              containerClassName="w-36"
              size="sm"
              aria-label="요청 제한 시간(밀리초)"
              defaultValue={120000}
              step={1000}
              disabled={off}
            />
            <span className="text-ui-sm text-text-tertiary">ms</span>
          </div>
        </SettingRow>
        <SettingRow
          label="스트리밍 예전 방식"
          k="l1.models.legacyStreaming"
          scope="user"
          apply="nextTurn"
          disabled={off}
          flag={
            <Badge size="sm" tone="outline">
              폐기 예정
            </Badge>
          }
        >
          <Switch size="sm" aria-label="스트리밍 예전 방식" defaultChecked={false} disabled={off} />
        </SettingRow>
      </SettingSection>
    </>
  );
}
