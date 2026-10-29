// caustic 빈틈: IconButton에 개수 배지 자리가 없다(제목 띠 "받은 요청 5"). IconButton을 그대로 쓰고 모서리에
// caustic Badge(size xs, solid)를 겹친다. 배지는 장식이고(aria-hidden) 개수는 버튼 라벨 문장에 넣는다.
import { Badge, IconButton, type IconButtonProps } from "@caustic/react";

export function CountIconButton({ count, ...props }: IconButtonProps & { count: number }) {
  return (
    <span className="relative inline-flex">
      <IconButton {...props} />
      {count > 0 && (
        <Badge
          aria-hidden
          size="xs"
          tone="accent"
          variant="solid"
          className="pointer-events-none absolute -top-1 -right-1 min-w-4 justify-center px-1 tabular-nums"
        >
          {count}
        </Badge>
      )}
    </span>
  );
}
