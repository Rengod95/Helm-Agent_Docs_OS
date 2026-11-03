import { Button, Field, Input } from "@caustic/react";
import { t } from "@fresnel/client/i18n";
import type { KeyField } from "@fresnel/client/settings";
import { useRef, type ReactNode } from "react";

// 키 값 입력 칸(L4.desktop-ux §4.14.1, §6.5). 입력란은 제어 컴포넌트가 아니다: 값은 DOM에만 있고 React 상태와 props에 들어가지 않는다.
// 저장을 누르면 부모가 `field.take()`로 읽는 즉시 비운다. 취소와 사라짐(unmount)도 비운다.
// caustic `Input`은 안쪽 `ref`를 쓰므로 바깥 `ref`를 넘기면 포커스가 깨진다. 그래서 폼의 `FormData`로 읽고 `reset()`으로 비운다.

export function FirstRunKeyForm(props: {
  readonly busy: boolean;
  readonly onSubmit: (field: KeyField) => void;
  readonly onCancel: () => void;
}): ReactNode {
  const formRef = useRef<HTMLFormElement | null>(null);
  return (
    <form
      ref={formRef}
      className="grid gap-3"
      autoComplete="off"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        props.onSubmit({
          take: () => {
            // 부모가 첫 `await` 전에 부르므로 이 순간 값을 읽고 바로 비운다
            const read = new FormData(form).get("key");
            form.reset();
            return typeof read === "string" ? read : "";
          },
        });
      }}
    >
      <Field
        label={t("desktop.firstRun.key.valueLabel")}
        hint={t("desktop.firstRun.key.valueNote")}
      >
        <Input
          type="password"
          name="key"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          defaultValue=""
          disabled={props.busy}
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" loading={props.busy}>
          {t("desktop.settings.save.button")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={props.busy}
          onClick={() => {
            formRef.current?.reset();
            props.onCancel();
          }}
        >
          {t("desktop.settings.cancel.button")}
        </Button>
      </div>
    </form>
  );
}
