import { useSyncExternalStore } from "react";

import { clearDiag, diagVersion, getDiag, subscribeDiag } from "@/pane/diag";
import { Section } from "@/pane/ui";
import { cn } from "@/lib/utils";

/** 진단 로그 (접이식) — 실제 PowerPoint 검증 시 Office.js 호출 결과 확인용 */
export default function DiagPanel() {
  useSyncExternalStore(subscribeDiag, diagVersion);
  const list = getDiag();
  return (
    <Section
      title={`진단 (${list.length})`}
      defaultOpen={false}
      right={
        <button type="button" onClick={clearDiag} className="text-[11px] text-muted-foreground hover:text-foreground">
          지우기
        </button>
      }
    >
      <div className="max-h-48 overflow-y-auto rounded border border-border bg-secondary/40 p-1.5 font-mono text-[10px] leading-snug" data-testid="diag">
        {list.length === 0 && <p className="text-muted-foreground">기록 없음</p>}
        {list
          .slice(-80)
          .reverse()
          .map((e, i) => (
            <p key={i} className={cn("break-words", e.level === "error" && "text-destructive", e.level === "warn" && "text-amber-700")}>
              {new Date(e.t).toLocaleTimeString("ko-KR")} {e.text}
            </p>
          ))}
      </div>
    </Section>
  );
}
