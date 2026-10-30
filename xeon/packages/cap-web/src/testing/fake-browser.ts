import type {
  BrowseActInput,
  BrowsePage,
  BrowseReadInput,
  BrowseReadOutput,
  BrowserOpenOptions,
  BrowserSessionHandle,
  BrowserStep,
  ProviderAvailabilityWeb,
  WebBrowseProvider,
  WebProviderManifest,
} from "@xeon/contracts/capabilities";
import type { BrowseCandidate } from "../ports/providers.ts";
import { fakeManifest } from "./fake-providers.ts";

// 가짜 브라우저 provider(L2.web.spec §4.10, M3-new-13). 좁은 포트 `WebBrowseProvider` 뒤에서 스크립트된 페이지를 돌려준다.
// Stagehand 등 실제 엔진은 이 포트의 어댑터로 붙는다.

export interface FakePage {
  readonly url: string;
  readonly title?: string;
  readonly text?: string;
  /** 요소 ref → 역할·이름·폼 action. `describe`가 돌려준다 */
  readonly elements?: Readonly<
    Record<string, { readonly role: string; readonly name?: string; readonly formAction?: string }>
  >;
}

export interface FakeBrowseProvider extends WebBrowseProvider {
  readonly opened: BrowserOpenOptions[];
  /** 열린 세션이 받은 동작 기록(navigate는 `navigate:<url>`, 나머지는 `<action>`) */
  readonly log: string[];
  readonly closed: () => number;
  setAvailability(next: ProviderAvailabilityWeb): void;
  /** 다음 `open`부터 던질 오류. undefined면 정상 */
  failOpenWith(thrown: Error | undefined): void;
  /**
   * 다음 동작이 일으킬 최상위 이동(리다이렉트 시험). 한 번 쓰고 비운다
   */
  redirectNextTo(url: string): void;
}

export interface FakeBrowseOptions {
  readonly manifest?: WebProviderManifest;
  readonly availability?: ProviderAvailabilityWeb;
  /** URL → 페이지. 없는 URL은 빈 페이지다 */
  readonly pages?: Readonly<Record<string, FakePage>>;
}

function pageOf(page: FakePage | undefined, url: string): BrowsePage {
  return { url: page?.url ?? url, title: page?.title ?? "", tabId: "t1" };
}

export function fakeBrowseProvider(
  id: string,
  options: FakeBrowseOptions = {},
): FakeBrowseProvider {
  const opened: BrowserOpenOptions[] = [];
  const log: string[] = [];
  let closedCount = 0;
  let availability: ProviderAvailabilityWeb = options.availability ?? { ok: true };
  let openThrown: Error | undefined;
  let redirect: string | undefined;
  const pages = options.pages ?? {};
  return {
    id,
    manifest:
      options.manifest ?? fakeManifest(id.replace(/^plugin:/, ""), { services: ["browse"] }),
    opened,
    log,
    closed: () => closedCount,
    setAvailability(next) {
      availability = next;
    },
    failOpenWith(value) {
      openThrown = value;
    },
    redirectNextTo(url) {
      redirect = url;
    },
    isAvailable: () => Promise.resolve(availability),
    open(browserOptions) {
      if (openThrown !== undefined) return Promise.reject(openThrown);
      opened.push(browserOptions);
      let current: FakePage | undefined;
      let currentUrl = "about:blank";
      const step = (url: string): BrowserStep => {
        const navigations = redirect === undefined ? [url] : [url, redirect];
        const landed = redirect ?? url;
        redirect = undefined;
        currentUrl = landed;
        current = pages[landed];
        return { page: pageOf(current, landed), navigations };
      };
      const handle: BrowserSessionHandle = {
        navigate(url) {
          log.push(`navigate:${url}`);
          return Promise.resolve(step(url));
        },
        act(action: BrowseActInput) {
          log.push(action.action);
          if (action.action === "navigate" && action.url !== undefined) {
            return Promise.resolve(step(action.url));
          }
          const landed = redirect;
          redirect = undefined;
          if (landed !== undefined) {
            currentUrl = landed;
            current = pages[landed];
            return Promise.resolve({ page: pageOf(current, landed), navigations: [landed] });
          }
          return Promise.resolve({ page: pageOf(current, currentUrl), navigations: [] });
        },
        read(request: BrowseReadInput) {
          log.push(`read:${request.mode}`);
          const output: Omit<BrowseReadOutput, "meta"> = {
            page: pageOf(current, currentUrl),
            ...(request.mode === "text" ? { text: current?.text ?? "" } : {}),
          };
          return Promise.resolve(output);
        },
        describe(target) {
          const found = current?.elements?.[target.ref];
          return Promise.resolve(found ?? { role: "generic" });
        },
        close() {
          closedCount += 1;
          return Promise.resolve();
        },
      };
      return Promise.resolve(handle);
    },
  };
}

export function browseCandidate(
  provider: WebBrowseProvider,
  origin: BrowseCandidate["origin"],
  cachePolicy: BrowseCandidate["cachePolicy"] = "none",
): BrowseCandidate {
  return { provider, origin, cachePolicy };
}
