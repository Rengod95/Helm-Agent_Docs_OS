// 일러스트 세트 미리보기: 같은 그림을 밝음·어두움 두 판에 나란히. ?theme=dark는 문서 바탕만 바꾼다.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Art, anchors, artSize, type ArtName } from "../_art";
import { loadCausticFonts } from "../_shell";
import "./mockup.css";

loadCausticFonts();

const HERO_LABELS: Record<string, string> = {
  input: "입력",
  request: "요청",
  tool: "도구",
  boundary: "단계 경계",
  session: "대화·수명",
};

function Labeled({ name, width }: { name: ArtName; width: number }) {
  const a = (anchors as Record<string, Record<string, { x: number; y: number }>>)[name] ?? {};
  const { w, h } = artSize[name];
  return (
    <div className="relative" style={{ width, height: (width * h) / w }}>
      <Art name={name} label={name} />
      {Object.entries(a).map(([k, p]) => (
        <span
          key={k}
          className="artp-label"
          style={
            name.startsWith("layer")
              ? { left: `${p.x * 100}%`, top: `${p.y * 100}%`, transform: "translate(-110%, -50%)" }
              : { left: `${p.x * 100}%`, top: `${p.y * 100}%` }
          }
        >
          {HERO_LABELS[k] ?? k}
        </span>
      ))}
    </div>
  );
}

function Card({ name, width, caption }: { name: ArtName; width: number; caption: string }) {
  return (
    <figure className="artp-card m-0 grid justify-items-center gap-2 rounded-lg p-3">
      <div style={{ width }}>
        <Art name={name} label={caption} />
      </div>
      <figcaption className="artp-cap text-ui-xs">
        {caption} · {name}
      </figcaption>
    </figure>
  );
}

const SPOTS: [ArtName, string][] = [
  ["spot-plugin", "플러그인"],
  ["spot-intent-group", "플러그인 그룹"],
  ["spot-context", "맥락"],
  ["spot-profile", "프로필"],
  ["spot-trial", "테스트 실행"],
  ["spot-replay", "살펴보기·재생"],
  ["spot-hook", "훅"],
  ["spot-capability", "기능"],
];
const EMPTIES: [ArtName, string][] = [
  ["empty-no-plugins", "플러그인 없음"],
  ["empty-context", "이 맥락에 아무것도 없음"],
  ["empty-offline", "오프라인"],
];

function Panel({ theme }: { theme: "light" | "dark" }) {
  return (
    <section data-art-theme={theme} className="artp-panel grid content-start gap-6 p-6">
      <h2 className="m-0 text-ui-sm font-medium">{theme === "light" ? "밝음" : "어두움"}</h2>
      <div className="grid gap-3">
        <Labeled name="hero-lifecycle" width={640} />
        <div className="flex flex-wrap items-end gap-3">
          <Card name="hero-lifecycle-active" width={400} caption="도구 단계 강조" />
          <Card name="hero-lifecycle" width={280} caption="280px 축소" />
        </div>
      </div>
      <div className="flex flex-wrap items-start gap-3">
        <Labeled name="layer-stack" width={400} />
        <Card name="layer-stack-insert" width={300} caption="L1에 넣는 중" />
      </div>
      <div className="grid grid-cols-4 gap-3">
        {SPOTS.map(([n, c]) => (
          <Card key={n} name={n} width={160} caption={c} />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {EMPTIES.map(([n, c]) => (
          <Card key={n} name={n} width={240} caption={c} />
        ))}
      </div>
    </section>
  );
}

/** ?focus=<이름>&w=<px>: 한 그림만 크게(선 굵기·축 점검용) */
function Focus({ name, width }: { name: ArtName; width: number }) {
  return (
    <main className="grid grid-cols-2">
      {(["light", "dark"] as const).map((t) => (
        <section key={t} data-art-theme={t} className="artp-panel grid place-items-center p-6">
          <div style={{ width }}>
            <Art name={name} label={name} />
          </div>
        </section>
      ))}
    </main>
  );
}

function Preview() {
  const q = new URLSearchParams(window.location.search);
  const focus = q.get("focus");
  if (focus !== null && focus in artSize)
    return <Focus name={focus as ArtName} width={Number(q.get("w") ?? 600)} />;
  return (
    <main className="grid grid-cols-2 bg-bg-app">
      <Panel theme="light" />
      <Panel theme="dark" />
    </main>
  );
}

const root = document.getElementById("root");
if (root !== null)
  createRoot(root).render(
    <StrictMode>
      <Preview />
    </StrictMode>,
  );
