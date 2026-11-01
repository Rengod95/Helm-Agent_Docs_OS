// S6 키 찾기: 라벨·키·도움말을 로컬로 찾고, 찾은 항목을 탭별로 묶어 그 자리에서 바꾼다. 탭 열은 탭마다 찾은 개수.
import { NumberField } from "@caustic/react";
import { SettingRow, SettingSection } from "../../_settings/row";
import type { TabId } from "../../_settings/tabs";

export const SEARCH_COUNTS: Partial<Record<TabId, number>> = {
  models: 1,
  tools: 2,
  runtime: 1,
  plugins: 1,
};

function Ms({ label, v }: { label: string; v: number }) {
  return (
    <div className="flex items-center gap-2">
      <NumberField
        appearance="stepper"
        containerClassName="w-36"
        size="sm"
        aria-label={label}
        defaultValue={v}
        step={1000}
      />
      <span className="text-ui-sm text-text-tertiary">ms</span>
    </div>
  );
}

export function SearchResults() {
  return (
    <>
      <SettingSection title="모델">
        <SettingRow
          label="요청 제한 시간"
          k="l1.models.requestTimeoutMs"
          scope="default"
          apply="nextTurn"
        >
          <Ms label="요청 제한 시간" v={120000} />
        </SettingRow>
      </SettingSection>
      <SettingSection title="도구와 웹">
        <SettingRow
          label="도구 실행 제한 시간"
          k="l1.tools.bash.timeoutMs"
          scope="project"
          apply="nextTurn"
        >
          <Ms label="도구 실행 제한 시간" v={120000} />
        </SettingRow>
        <SettingRow
          label="웹 가져오기 제한 시간"
          k="l2.web.fetch.timeoutMs"
          scope="default"
          apply="nextTurn"
        >
          <Ms label="웹 가져오기 제한 시간" v={15000} />
        </SettingRow>
      </SettingSection>
      <SettingSection title="실행과 서비스">
        <SettingRow
          label="연결 시간 초과"
          k="l4.desktop.connect.timeoutMs"
          scope="user"
          apply="now"
        >
          <Ms label="연결 시간 초과" v={5000} />
        </SettingRow>
      </SettingSection>
      <SettingSection title="플러그인과 그룹">
        <SettingRow
          label="핸들러 시간 예산"
          k="x.operations.handlerTimeoutMs"
          scope="default"
          apply="restart"
        >
          <Ms label="핸들러 시간 예산" v={2000} />
        </SettingRow>
      </SettingSection>
    </>
  );
}
