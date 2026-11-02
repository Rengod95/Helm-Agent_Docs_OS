// P-11 부품(caustic 토큰과 Tailwind만).
//   Gauge: 사용량 한 줄. caustic에 Meter가 없어(C-05) Progress bar + 글로 만든다. 한도를 모르면 막대 대신 "한도 모름"(W-11).
//   AccountGrid: provider 하나의 계정 풀. List reorderable은 행 안에 편집 칸 여러 개를 둘 수 없어, 끌기 손잡이 + 칸 격자를 직접 만든다.
import {
  Button,
  IconButton,
  Menu,
  MenuItem,
  NumberField,
  Progress,
  Select,
  SelectOption,
} from "@caustic/react";
import { Ellipsis, GripVertical, Trash2 } from "../_shell";

export function Gauge({
  label,
  value,
  ratio,
  limit,
}: {
  label: string;
  value: string;
  ratio: number | null;
  limit: string;
}) {
  return (
    <div
      role="group"
      aria-label={`${label} ${value}, ${limit}`}
      className="grid grid-cols-[9rem_minmax(0,14rem)_auto] items-center gap-3 py-1 text-ui @max-[30rem]:grid-cols-[7rem_minmax(0,1fr)]"
    >
      <span className="text-text-secondary">{label}</span>
      {ratio === null ? (
        <span aria-hidden className="h-1 rounded-full bg-neutral-soft" />
      ) : (
        <Progress value={ratio * 100} size="sm" decorative />
      )}
      <span className="flex items-baseline gap-2 tabular-nums @max-[30rem]:col-start-2">
        <span className="font-mono text-mono text-text-primary">{value}</span>
        <span className="text-ui-sm text-text-tertiary">{limit}</span>
      </span>
    </div>
  );
}

export interface Account {
  id: string;
  secret: string;
  priority: number;
  reserve: number;
  changed?: boolean;
  error?: string;
}

const SECRETS = ["ant-work", "ant-me", "anthropic-api-key"];
const COLS = "grid-cols-[1.5rem_minmax(5rem,7rem)_minmax(0,15rem)_5.5rem_5.5rem_1.75rem]";

export function AccountGrid({
  provider,
  accounts,
  disabled,
}: {
  provider: string;
  accounts: Account[];
  disabled?: boolean | undefined;
}) {
  return (
    <div role="table" aria-label={`${provider} 계정`} className="grid">
      <div
        role="row"
        className={`grid ${COLS} items-center gap-2 pb-1 text-ui-sm text-text-tertiary`}
      >
        <span role="columnheader">
          <span className="sr-only">순서</span>
        </span>
        <span role="columnheader">계정</span>
        <span role="columnheader">자격(시크릿)</span>
        <span role="columnheader">우선</span>
        <span role="columnheader">예비 %</span>
        <span role="columnheader">
          <span className="sr-only">동작</span>
        </span>
      </div>
      {accounts.map((a) => (
        <div key={a.id} role="row" className="grid gap-1 py-0.5">
          <div className={`grid ${COLS} items-center gap-2`}>
            <IconButton
              size="xs"
              variant="ghost"
              label={`${a.id} 순서 바꾸기`}
              disabled={disabled === true}
              className="cursor-grab text-text-tertiary"
            >
              <GripVertical />
            </IconButton>
            <span role="cell" className="truncate font-mono text-mono text-text-primary">
              {a.id}
            </span>
            <span role="cell" className="min-w-0">
              <Select
                size="xs"
                aria-label={`${a.id} 자격`}
                defaultValue={a.secret}
                disabled={disabled === true}
                className="w-full font-mono"
              >
                {SECRETS.map((s) => (
                  <SelectOption key={s} value={s}>
                    <span className="font-mono text-mono-sm">secret://{s}</span>
                  </SelectOption>
                ))}
              </Select>
            </span>
            <span role="cell">
              <NumberField
                size="xs"
                aria-label={`${a.id} 우선순위`}
                defaultValue={a.priority}
                step={10}
                disabled={disabled === true}
              />
            </span>
            <span role="cell">
              <NumberField
                size="xs"
                aria-label={`${a.id} 예비율`}
                defaultValue={a.reserve}
                unit="%"
                invalid={a.error !== undefined}
                disabled={disabled === true}
                containerClassName={
                  a.changed
                    ? "shadow-[inset_0_0_0_1px_var(--cs-color-accent-border)] rounded-[10px]"
                    : undefined
                }
              />
            </span>
            <Menu
              align="end"
              aria-label={`${a.id} 메뉴`}
              trigger={
                <IconButton
                  size="xs"
                  variant="ghost"
                  label={`${a.id} 메뉴`}
                  disabled={disabled === true}
                >
                  <Ellipsis />
                </IconButton>
              }
            >
              <MenuItem>이름 바꾸기</MenuItem>
              <MenuItem icon={<Trash2 />} tone="danger">
                지우기
              </MenuItem>
            </Menu>
          </div>
          {a.error !== undefined && (
            <p role="alert" className="m-0 ps-[calc(1.25rem+0.5rem)] text-ui-sm text-danger-text">
              {a.error}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

export function AddAccountButton({ disabled }: { disabled?: boolean | undefined }) {
  return (
    <Button size="xs" tone="neutral" variant="ghost" disabled={disabled === true}>
      계정 추가
    </Button>
  );
}
