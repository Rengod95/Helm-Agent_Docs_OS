import { Button, Dialog, DialogClose } from "@caustic/react";
import { t } from "@fresnel/client/i18n";
import type { KeyPreflight } from "@fresnel/client/settings";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { SecretCommands } from "../../commands.ts";

// 등록 전 한 번 묻는 확인(L0.secrets.spec §4.7 (c)). OS 키 저장소를 쓸 수 없어 `auto`가 파일로 떨어졌고 사람이 확인하지 않았으면,
// 등록을 시작하기 전에 묻는다. 승인하면 설정을 `file`로 옮기고(키가 아직 없으면 설정만 바뀐다) 등록은 이어서 끝난다. 취소면 등록하지 않는다.
// 값은 이 파일이 읽지 않는다: 확인을 기다리는 동안 값은 입력란 DOM에만 있다(`submitKey`가 `preflight`가 끝난 뒤에 읽는다).
// 확인 단추는 `DialogAction`(파괴적 단추이고 누르면 닫힌다)을 쓰지 않는다. 승인은 닫힘과 함께 `true`를 돌려준다.

type Keys = Pick<SecretCommands, "keyStatus" | "keyMove">;

/**
 * 등록 전 확인의 흐름. 위치를 읽어 확인이 필요 없으면 `proceed`다. 필요하면 `ask`로 묻는다: 아니오면 `cancel`(아무것도 옮기지 않는다),
 * 예면 파일 쪽으로 옮긴 뒤 `proceed`다. 위치를 못 읽으면(원격, 옛 호스트) 막지 않고 `proceed`다. 그때 등록이 거절되면 그 실패 문장이 원인을 말한다.
 */
export async function confirmFallbackOf(
  keys: Keys,
  ask: () => Promise<boolean>,
): Promise<"proceed" | "cancel"> {
  const status = await keys.keyStatus();
  if (!status.ok || !status.value.fallbackUnconfirmed) return "proceed";
  if (!(await ask())) return "cancel";
  // 옮기기 결과는 보지 않는다. 거절되면 등록이 거절되고, 그 실패 문장이 원인을 말한다
  await keys.keyMove("file");
  return "proceed";
}

export interface FallbackConfirm {
  /** `submitKey`의 `preflight` 자리에 넘긴다 */
  readonly preflight: KeyPreflight;
  /** 화면 그림 끝에 둔다. 확인이 떠 있지 않으면 닫힌 대화 상자다 */
  readonly dialog: ReactNode;
}

/** 등록 전 확인을 화면에 잇는 훅. 대화 상자의 답을 `confirmFallbackOf`에 준다. 화면이 사라지면 아니오로 끝낸다 */
export function useFallbackConfirm(keys: Keys): FallbackConfirm {
  const [open, setOpen] = useState(false);
  const answer = useRef<((accepted: boolean) => void) | null>(null);

  const close = useCallback((accepted: boolean): void => {
    const resolve = answer.current;
    answer.current = null;
    setOpen(false);
    resolve?.(accepted);
  }, []);

  const ask = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        answer.current = resolve;
        setOpen(true);
      }),
    [],
  );

  const preflight = useCallback<KeyPreflight>(() => confirmFallbackOf(keys, ask), [keys, ask]);

  // 확인이 떠 있는 채로 화면이 사라지면 기다리는 등록을 취소로 끝낸다(멈춘 약속을 남기지 않는다)
  useEffect(
    () => () => {
      close(false);
    },
    [close],
  );

  const dialog = (
    <Dialog
      kind="alert"
      size="sm"
      open={open}
      onOpenChange={(next) => {
        if (!next) close(false);
      }}
      title={t("desktop.secrets.keyStore.confirm.title")}
      description={t("desktop.secrets.keyStore.confirm.body")}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" size="sm" autoFocus>
              {t("desktop.secrets.cancel")}
            </Button>
          </DialogClose>
          <Button
            variant="solid"
            size="sm"
            onClick={() => {
              close(true);
            }}
          >
            {t("desktop.secrets.keyStore.confirm.keep")}
          </Button>
        </>
      }
    >
      <p className="m-0 text-ui text-text-secondary">
        {t("desktop.secrets.keyStore.confirm.meaning")}
      </p>
    </Dialog>
  );

  return { preflight, dialog };
}
