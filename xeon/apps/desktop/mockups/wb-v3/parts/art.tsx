// 일러스트 연결: mockups/_art(일러스트레이터 세트, m4/art 1d154234)를 그대로 쓴다.
import "../../_art/art.css";
import { Art as XArt, anchors, artSize, type ArtName } from "../../_art";

export { anchors, artSize, type ArtName };

/** 일러스트레이터 세트(m4/art 1d154234)를 인라인으로 그린다. 장식이 아니면 label을 준다. */
export function Art({
  name,
  className = "",
  label,
}: {
  name: ArtName;
  className?: string;
  label?: string;
}) {
  return label === undefined ? (
    <XArt name={name} className={className} />
  ) : (
    <XArt name={name} className={className} label={label} />
  );
}
