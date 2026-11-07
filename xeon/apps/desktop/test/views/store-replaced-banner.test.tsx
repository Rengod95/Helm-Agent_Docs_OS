import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { activeLocale, setActiveLocale, t, type Locale } from "@fresnel/client/i18n";
import type { StartupNotice } from "@fresnel/contracts/wire";
import { HostNoticesContext } from "../../src/views/host-notices-context.ts";
import { movedStoreFileOf, storeReplacedTextOf } from "../../src/views/store-replaced-model.ts";
import {
  StoreReplacedBanner,
  StoreReplacedBannerView,
} from "../../src/views/store-replaced-banner.tsx";

// 시작 때 빈 DB를 옮긴 일의 띠(`store-replaced-banner.tsx`)를 서버 렌더로 본다. 옮긴 파일의 자리를 홈 줄임(`~`)으로 보이고,
// 닫기 단추를 그린다. 알림 값이 없거나 옮긴 일이 없으면 아무것도 그리지 않는다.

const MOVED: StartupNotice = {
  kind: "store_empty_replaced",
  movedTo: "/Users/me/.fresnel/fresnel.db.broken-20261108T010203456Z",
};

describe("the store replaced banner", () => {
  let previous: Locale = "ko";
  beforeEach(() => {
    previous = activeLocale();
    setActiveLocale("ko");
  });
  afterEach(() => {
    setActiveLocale(previous);
  });

  test("the sentence names the moved file with the home folder shortened", () => {
    expect(storeReplacedTextOf(MOVED.movedTo)).toBe(
      "데이터베이스 파일이 비어 있어서 새로 만들었어요. 원래 파일은 ~/.fresnel/fresnel.db.broken-20261108T010203456Z에 남겨 뒀어요",
    );
  });

  test("the view shows the sentence and a close button", () => {
    const out = renderToString(
      <StoreReplacedBannerView movedTo={MOVED.movedTo} onDismiss={() => {}} />,
    );
    expect(out).toContain("~/.fresnel/fresnel.db.broken-20261108T010203456Z에 남겨 뒀어요");
    expect(out).toContain(t("desktop.status.storeReplaced.dismiss"));
  });

  test("the banner draws nothing without a notice or when no store file was moved", () => {
    expect(renderToString(<StoreReplacedBanner />)).toBe("");
    expect(
      renderToString(
        <HostNoticesContext value={{ settingsProblems: [], startupNotices: [] }}>
          <StoreReplacedBanner />
        </HostNoticesContext>,
      ),
    ).toBe("");
  });

  test("the banner reads the moved file from the host notices", () => {
    const out = renderToString(
      <HostNoticesContext value={{ settingsProblems: [], startupNotices: [MOVED] }}>
        <StoreReplacedBanner />
      </HostNoticesContext>,
    );
    expect(out).toContain("~/.fresnel/fresnel.db.broken-20261108T010203456Z에 남겨 뒀어요");
    expect(out).toContain(t("desktop.status.storeReplaced.dismiss"));
  });

  test("the moved file is found among the notices, and none is null", () => {
    expect(movedStoreFileOf([])).toBeNull();
    expect(movedStoreFileOf([MOVED])).toBe(MOVED.movedTo);
  });
});
