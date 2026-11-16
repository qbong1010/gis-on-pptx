import { useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * 버튼 + 떠 있는 패널. 바깥 클릭·Escape 로 닫힘.
 * trigger({open, toggle}) 로 버튼을 그리고 children 에 패널 내용을 넣는다. children 이 함수면 close 를 받는다.
 */
export function Popover({
  trigger,
  children,
  align = "right",
  className,
  panelClassName,
}: {
  trigger: (s: { open: boolean; toggle: () => void }) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: "left" | "right";
  className?: string;
  panelClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  // 스크롤 영역(overflow)에 잘리지 않도록 fixed 로 띄우고, 아래 공간이 모자라면 위로 뒤집는다
  useLayoutEffect(() => {
    if (!open) return setPos(null);
    const t = ref.current?.getBoundingClientRect();
    const pn = panelRef.current;
    if (!t || !pn) return;
    const w = pn.offsetWidth;
    const h = pn.offsetHeight;
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    let left = align === "right" ? t.right - w : t.left;
    left = Math.max(4, Math.min(left, vw - w - 4));
    let top = t.bottom + 4;
    if (top + h > vh - 4) top = Math.max(4, t.top - h - 4);
    setPos({ top, left });
  }, [open, align]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const close = () => setOpen(false);
  return (
    <div ref={ref} className={cn("relative", className)}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div
          ref={panelRef}
          style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: "hidden" }}
          className={cn("fixed z-[3500] min-w-[180px] rounded-lg border border-border bg-background p-1 text-[12px] shadow-lg", panelClassName)}
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      )}
    </div>
  );
}

/** 팝오버 안의 메뉴 항목 */
export function MenuItem({ icon, children, danger, ...p }: { icon?: ReactNode; danger?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...p}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40",
        danger && "text-destructive",
      )}
    >
      {icon}
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  );
}
