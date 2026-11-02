// 개요 탭: 범위별 설정 파일, 바꾼 항목, 대기 중인 재시작, 화면 진단(ViewDiagnostic).
import { Badge, Button, ListDescription, ListDescriptionRow } from "@caustic/react";
import { CircleAlert, Info, TriangleAlert } from "../_shell";
import { SettingSection } from "../_settings/row";

const ld = "rounded-none [--cs-size-list-term:9rem] [&_[data-slot=list-description-row]]:px-0";

const DIAG = [
  {
    tone: "warning",
    text: "프로젝트 파일에 모르는 키가 있어요",
    key: "l2.web.legacyProxy",
    where: "~/code/fresnel/.fresnel/settings.json",
  },
  {
    tone: "info",
    text: "전용 편집기가 아직 없어 표로 보여요",
    key: "l1.models.accounts",
    where: "계정과 제공자",
  },
  {
    tone: "danger",
    text: "값이 스키마와 달라 기본값을 써요",
    key: "l1.context.compactAt",
    where: "~/.fresnel/settings.json · 120",
  },
] as const;

export function OverviewTab() {
  return (
    <>
      <SettingSection title="설정 파일">
        <ListDescription variant="ghost" size="xs" aria-label="설정 파일" className={ld}>
          <ListDescriptionRow term="사용자" mono copyValue="~/.fresnel/settings.json">
            ~/.fresnel/settings.json
          </ListDescriptionRow>
          <ListDescriptionRow
            term="프로젝트"
            mono
            copyValue="~/code/fresnel/.fresnel/settings.json"
          >
            ~/code/fresnel/.fresnel/settings.json
          </ListDescriptionRow>
          <ListDescriptionRow term="관리 정책" mono>
            /etc/fresnel/managed.json
          </ListDescriptionRow>
        </ListDescription>
      </SettingSection>
      <SettingSection title="지금 상태">
        <ListDescription variant="ghost" size="xs" aria-label="지금 상태" className={ld}>
          <ListDescriptionRow term="기본값에서 바꾼 항목">
            14개 · 사용자 9, 프로젝트 5
          </ListDescriptionRow>
          <ListDescriptionRow term="관리 정책 잠금">3개</ListDescriptionRow>
          <ListDescriptionRow term="재시작 대기">
            <span className="flex items-center gap-2">
              <Badge size="sm" tone="warning">
                1개
              </Badge>
              <span className="font-mono text-mono-sm text-text-secondary">
                l1.engine.maxConcurrentTurns
              </span>
            </span>
          </ListDescriptionRow>
          <ListDescriptionRow term="안전 모드">꺼짐</ListDescriptionRow>
        </ListDescription>
      </SettingSection>
      <SettingSection
        title="화면 진단 3"
        end={
          <Button size="xs" tone="neutral" variant="ghost">
            진단 복사
          </Button>
        }
      >
        <ul className="m-0 grid list-none gap-1 p-0">
          {DIAG.map((d) => {
            const I =
              d.tone === "danger" ? CircleAlert : d.tone === "warning" ? TriangleAlert : Info;
            const c =
              d.tone === "danger"
                ? "text-danger-text"
                : d.tone === "warning"
                  ? "text-warning-text"
                  : "text-text-tertiary";
            return (
              <li key={d.key} className="flex min-w-0 gap-2 py-1.5">
                <I aria-hidden className={`mt-0.5 size-icon-sm flex-none ${c}`} />
                <div className="grid min-w-0 gap-0.5">
                  <span className="text-ui text-text-primary">{d.text}</span>
                  <span className="truncate font-mono text-mono-sm text-text-tertiary">
                    {d.key} · {d.where}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </SettingSection>
    </>
  );
}
