import type { SecretName } from "@xeon/contracts/capabilities";
import type {
  SecretEntryAction,
  SecretEntryOffer,
  SecretOutOfBandPort,
  SecretRevealOffer,
} from "@xeon/contracts/services";

// F.wire-settings.spec §3.3.1 secret.beginEntry·beginReveal, services/secret-admin.ts SecretOutOfBandPort.
// in-process 접속(CLI)이 값 입력·열람 수단을 wire 밖으로 호스트에 맡기는 통로의 구현이다. 맡긴 수단은 한 번 쓰이면 비워진다.
// 값은 이 파일을 지나지 않는다. 입력 수단(SecretValueSource)과 표시 콜백만 지나가고, 그것을 부르는 것은 SecretAdminService다.

/** 호스트 처리기가 맡긴 수단을 꺼내는 쪽. 맡기는 쪽(SecretOutOfBandPort)과 한 저장소를 쓴다 */
export interface SecretOfferStore extends SecretOutOfBandPort {
  /** 이름과 동작이 같은 입력 수단 하나를 꺼낸다. 없으면 undefined */
  takeEntry(name: SecretName, action: SecretEntryAction): SecretEntryOffer | undefined;
  /** 이름이 같은 열람 수단 하나를 꺼낸다. 없으면 undefined */
  takeReveal(name: SecretName): SecretRevealOffer | undefined;
}

function entryKey(name: SecretName, action: SecretEntryAction): string {
  return `${action}:${name}`;
}

export function createSecretOfferStore(): SecretOfferStore {
  const entries = new Map<string, SecretEntryOffer>();
  const reveals = new Map<string, SecretRevealOffer>();
  return {
    offerEntry(offer) {
      const key = entryKey(offer.name, offer.action);
      entries.set(key, offer);
      return () => {
        // 이미 쓰였거나 같은 키로 다시 맡겨진 수단은 거두지 않는다
        if (entries.get(key) === offer) entries.delete(key);
      };
    },
    offerReveal(offer) {
      reveals.set(offer.name, offer);
      return () => {
        if (reveals.get(offer.name) === offer) reveals.delete(offer.name);
      };
    },
    takeEntry(name, action) {
      const key = entryKey(name, action);
      const offer = entries.get(key);
      entries.delete(key);
      return offer;
    },
    takeReveal(name) {
      const offer = reveals.get(name);
      reveals.delete(name);
      return offer;
    },
  };
}
