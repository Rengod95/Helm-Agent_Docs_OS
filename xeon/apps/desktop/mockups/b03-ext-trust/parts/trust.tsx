// O-10 확장 신뢰 확인(spec §6.31, ADR-0021 §3.5 등급표, X.loading-trust §4.6)과 그 차이 모드(coverage §4-2),
// N-38 지우기 확인(O-06 변형). 모두 Dialog kind="alert", 기본 초점은 "취소"(거절 쪽).
// - 신뢰 확인: 요청한 수준, 위치 상한, 실제 수준, 쓰는 연산, 훅, 자체 코드 화면이면 "자체 화면 코드 실행"과 frame.reason.
//   프로젝트 위치 확장은 프로젝트 신뢰(O-04 allow)가 먼저라, 아직이면 "켜기"를 잠그고 폴더 신뢰로 보낸다.
// - 다시 확인: 업데이트나 권한 변경으로 늘어난 것만 강조한다. 줄어든 변경은 묻지 않는다(목록 행 한 줄로만 알림).
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogClose,
  ListDescription,
  ListDescriptionRow,
} from "@caustic/react";
import {
  CodeXml,
  josa,
  Shield,
  ShieldCheck,
  T,
  ToneIcon,
  Trash2,
  TriangleAlert,
} from "../../_shell";
import { removal, taskflowDiff, type Manifest, type Trust } from "../data";
import { ExtLabel, LD, opName, trustName } from "./bits";

const RANK: Record<Trust, number> = { project: 0, user: 1, builtin: 2 };

/** 실제 신뢰 수준 = min(위치 상한, 요청). X.loading-trust §4.6.1. */
function effectiveTrust(m: Manifest): Trust {
  return RANK[m.requested] < RANK[m.ceiling] ? m.requested : m.ceiling;
}

function Foot({
  cancel,
  ok,
  okTone = "neutral",
  okDisabled = false,
  onOk,
}: {
  cancel: string;
  ok: string;
  okTone?: "neutral" | "danger";
  okDisabled?: boolean;
  onOk: () => void;
}) {
  return (
    <>
      <span aria-hidden className="flex-1" />
      <DialogClose asChild>
        <Button size="sm" variant="outline" autoFocus>
          {cancel}
        </Button>
      </DialogClose>
      <Button size="sm" tone={okTone} variant="solid" disabled={okDisabled} onClick={onOk}>
        {ok}
      </Button>
    </>
  );
}

export function TrustDialog({
  m,
  projectTrust,
  onTrustFolder,
  onEnable,
  onCancel,
}: {
  m: Manifest;
  projectTrust: "allow" | "undecided";
  onTrustFolder: () => void;
  onEnable: () => void;
  onCancel: () => void;
}) {
  const project = m.ceiling === "project";
  const blocked = project && projectTrust !== "allow";
  return (
    <Dialog
      kind="alert"
      size="md"
      open
      onOpenChange={(o) => !o && onCancel()}
      icon={<Shield />}
      title={`${josa(m.display, "을", "를")} 켤까요?`}
      description={`처음 켜는 ${T.extension}이에요. 켜면 이 코드가 엔진 안에서 아래 권한으로 돌아요.`}
      footer={<Foot cancel="취소" ok="켜기" okDisabled={blocked} onOk={onEnable} />}
    >
      <ListDescription variant="ghost" size="xs" aria-label={T.trustConfirm} className={LD}>
        <ListDescriptionRow term={T.extension}>
          <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
            <ExtLabel display={m.display} name={m.name} strong />
            <span className="text-text-tertiary">
              · {m.version} · {m.layer === m.kind ? m.layer : `${m.layer} ${m.kind}`}
            </span>
          </span>
        </ListDescriptionRow>
        {project && (
          <ListDescriptionRow term={T.projectTrust}>
            {blocked ? (
              <span className="inline-flex flex-wrap items-center gap-2">
                <ToneIcon tone="warning">
                  <TriangleAlert />
                </ToneIcon>
                먼저 이 폴더를 신뢰해야 켤 수 있어요
                <Button size="xs" variant="outline" onClick={onTrustFolder}>
                  폴더 신뢰…
                </Button>
              </span>
            ) : (
              <span>
                허용함{" "}
                <span className="font-mono text-mono-sm text-text-tertiary">~/code/fresnel</span>
              </span>
            )}
          </ListDescriptionRow>
        )}
        <ListDescriptionRow term={T.trustRequested}>{trustName[m.requested]}</ListDescriptionRow>
        <ListDescriptionRow term={T.trustCeiling}>
          {trustName[m.ceiling]}{" "}
          <span className="font-mono text-mono-sm text-text-tertiary">{m.dest}</span>
        </ListDescriptionRow>
        <ListDescriptionRow term={T.trustEffective}>
          <span className="font-medium">{trustName[effectiveTrust(m)]}</span>
        </ListDescriptionRow>
        <ListDescriptionRow term="쓰는 연산">
          <span className="inline-flex flex-wrap gap-x-3 gap-y-0.5">
            {m.ops.map((o) => (
              <span key={o}>{opName[o]}</span>
            ))}
          </span>
        </ListDescriptionRow>
        <ListDescriptionRow term={T.extensionPoint}>
          <span className="grid">
            {m.points.map((p) => (
              <span key={p}>{p}</span>
            ))}
          </span>
        </ListDescriptionRow>
        {m.frames.map((f) => (
          <ListDescriptionRow key={f.title} term={T.viewFrame}>
            <span className="grid gap-0.5">
              <span className="inline-flex items-center gap-1.5">
                <ToneIcon tone="warning">
                  <CodeXml />
                </ToneIcon>
                {f.title} · {f.slot} · 자체 화면 코드를 실행해요
              </span>
              <span className="whitespace-normal text-text-tertiary">“{f.reason}”</span>
            </span>
          </ListDescriptionRow>
        ))}
      </ListDescription>
    </Dialog>
  );
}

/** O-10 차이 모드: 늘어난 것만. 거절하면 이전 버전을 그대로 쓴다. */
export function RecheckDialog({
  onAccept,
  onDecline,
}: {
  onAccept: () => void;
  onDecline: () => void;
}) {
  const d = taskflowDiff;
  return (
    <Dialog
      kind="alert"
      size="md"
      open
      onOpenChange={(o) => !o && onDecline()}
      icon={<ShieldCheck />}
      title={`${d.display} ${josa(d.to, "이", "가")} 권한을 더 요청해요`}
      description={`늘어난 것만 보여요. 거절하면 ${josa(d.from, "을", "를")} 그대로 써요.`}
      footer={<Foot cancel={`${d.from} 그대로 쓰기`} ok="업데이트 켜기" onOk={onAccept} />}
    >
      <ListDescription variant="ghost" size="xs" aria-label={T.trustRecheck} className={LD}>
        <ListDescriptionRow term={T.extension}>
          <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
            <ExtLabel display={d.display} name={d.name} strong />
            <span className="text-text-secondary tabular-nums">
              {d.from} → {d.to}
            </span>
          </span>
        </ListDescriptionRow>
        <ListDescriptionRow term={T.trustEffective}>
          {trustName[d.requested.to]} <span className="text-text-tertiary">· 그대로</span>
        </ListDescriptionRow>
        {d.grown.map((g) => (
          <ListDescriptionRow key={g.text} term={g.kind}>
            <span className="grid gap-0.5">
              <span className="inline-flex items-center gap-1.5">
                <Badge size="sm" tone="warning">
                  늘어남
                </Badge>
                {g.text}
                {g.kind === "연산" && (
                  <span className="font-mono text-mono-sm text-text-tertiary">{g.code}</span>
                )}
                {g.kind === T.viewFrame && <span>· 자체 화면 코드를 실행해요</span>}
              </span>
              {g.kind === T.viewFrame && (
                <span className="whitespace-normal text-text-tertiary">“{g.code}”</span>
              )}
            </span>
          </ListDescriptionRow>
        ))}
        <ListDescriptionRow term="그대로인 것">
          <span className="grid text-text-tertiary">
            {d.same.map((x) => (
              <span key={x}>{x}</span>
            ))}
          </span>
        </ListDescriptionRow>
      </ListDescription>
    </Dialog>
  );
}

/** N-38 지우기 확인(O-06 변형): 쓰는 프로필, 화면 기여, 확장 저장 데이터. 기록(이벤트)은 남는다. */
export function RemoveDialog({
  display,
  name,
  dropTables,
  onDropTables,
  onRemove,
  onCancel,
}: {
  display: string;
  name: string;
  dropTables: boolean;
  onDropTables: (v: boolean) => void;
  onRemove: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      kind="alert"
      size="md"
      tone="danger"
      open
      onOpenChange={(o) => !o && onCancel()}
      icon={<Trash2 />}
      title={`${josa(display, "을", "를")} 지울까요?`}
      description={`${T.extension} ${josa(T.installFolder, "을", "를")} 지우고 이번 ${josa(T.step, "이", "가")} 끝나면 빠져요. 대화 기록은 남아요.`}
      footer={<Foot cancel="취소" ok={T.uninstall} okTone="danger" onOk={onRemove} />}
    >
      <ListDescription variant="ghost" size="xs" aria-label={`${T.uninstall} 영향`} className={LD}>
        <ListDescriptionRow term={T.extension}>
          <ExtLabel display={display} name={name} strong />
        </ListDescriptionRow>
        <ListDescriptionRow term={`쓰는 ${T.profile}`}>
          {removal.profiles.join(", ")}{" "}
          <span className="text-text-tertiary">· 이 {T.profile}에서도 빠져요</span>
        </ListDescriptionRow>
        <ListDescriptionRow term={T.pluginView}>
          <span className="grid">
            {removal.views.map((v) => (
              <span key={v.title}>
                {v.title} <span className="text-text-tertiary">· {v.slot}</span>
              </span>
            ))}
          </span>
        </ListDescriptionRow>
        <ListDescriptionRow term={T.extStorage}>
          <span className="grid gap-1">
            <span className="grid">
              {removal.tables.map((t) => (
                <span key={t.name}>
                  <span className="font-mono text-mono-sm">{t.name}</span>{" "}
                  <span className="text-text-tertiary tabular-nums">{t.rows}</span>
                </span>
              ))}
            </span>
            <label className="inline-flex cursor-pointer items-center gap-1.5">
              <Checkbox
                size="sm"
                checked={dropTables}
                onCheckedChange={(v) => onDropTables(v === true)}
              />
              {T.extStorage}도 지우기
            </label>
          </span>
        </ListDescriptionRow>
      </ListDescription>
    </Dialog>
  );
}
