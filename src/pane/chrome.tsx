/** 패널 상단 설정 팝오버 + 첫 실행 안내 카드 */
import { Check, ExternalLink, KeyRound, Settings2, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ENV_VWORLD_KEY } from "@/lib/basemaps";
import { cn } from "@/lib/utils";
import { IconButton, Popover, Toggle } from "@/pane/ui";

export function SettingsMenu({
  vworldKey,
  onKey,
  showDiag,
  onShowDiag,
  onShowGuide,
  openRef,
}: {
  vworldKey: string;
  onKey: (k: string) => void;
  showDiag: boolean;
  onShowDiag: (v: boolean) => void;
  onShowGuide: () => void;
  /** 바깥(배경지도 탭의 "설정에서 키 입력")에서 열 수 있게 */
  openRef?: { current: (() => void) | null };
}) {
  const [draft, setDraft] = useState(vworldKey);
  const [saved, setSaved] = useState(false);
  return (
    <Popover
      panelClassName="w-[290px] p-3"
      trigger={({ toggle, open }) => {
        if (openRef) openRef.current = () => !open && toggle();
        return (
          <IconButton label="설정" aria-haspopup="dialog" aria-expanded={open} onClick={toggle} data-testid="settings" active={open}>
            <Settings2 className="size-4" />
          </IconButton>
        );
      }}
    >
      {(close) => (
        <div role="dialog" aria-label="설정" className="space-y-3">
          <div>
            <label htmlFor="vworld-key" className="mb-1 flex items-center gap-1 text-[12px] font-semibold">
              <KeyRound className="size-3.5" />
              VWorld API 키
            </label>
            <div className="flex gap-1">
              <input
                id="vworld-key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setSaved(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    onKey(draft.trim());
                    setSaved(true);
                  }
                }}
                placeholder="VWorld 인증키"
                className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-[12px]"
                data-testid="vworld-key"
              />
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-[12px]"
                data-testid="vworld-save"
                onClick={() => {
                  onKey(draft.trim());
                  setSaved(true);
                }}
              >
                {saved ? <Check className="size-3.5" /> : null}
                저장
              </Button>
            </div>
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
              {vworldKey ? "키가 이 PC 에 저장되어 있습니다." : ENV_VWORLD_KEY ? "기본 키를 사용 중입니다." : "키가 없으면 브이월드 배경지도 대신 OpenStreetMap 이 표시됩니다."}{" "}
              <a href="https://www.vworld.kr" target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline underline-offset-2">
                키 발급 안내
                <ExternalLink className="size-3" />
              </a>
            </p>
          </div>
          <div className="border-t border-border pt-2">
            <Toggle checked={showDiag} onChange={onShowDiag} label="진단 로그 패널 보기" testId="toggle-diag" />
            <button
              type="button"
              onClick={() => {
                close();
                onShowGuide();
              }}
              className="mt-2 rounded text-[12px] text-foreground underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
            >
              시작 안내(도움말) 다시 보기
            </button>
            {/* 소스 코드 링크 (MIT, D-043) */}
            <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
              Slide Map · gis-on-pptx ·{" "}
              <a
                href="https://github.com/qbong1010/gis-on-pptx"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
              >
                소스 코드 (MIT)
              </a>
            </p>
          </div>
        </div>
      )}
    </Popover>
  );
}

const STEPS = [
  { n: 1, title: "지도 추가", desc: "[+ 지도 추가] 로 배경지도 넣기" },
  { n: 2, title: "파일 끌어넣기", desc: "SHP·GeoJSON 을 패널에 놓기" },
  { n: 3, title: "슬라이드에 반영", desc: "스타일을 고른 뒤 반영 버튼" },
];

export function Onboarding({ step, onDismiss }: { step: 1 | 2 | 3; onDismiss: () => void }) {
  return (
    <section aria-label="시작 안내" data-testid="onboarding" className="shrink-0 border-b border-border bg-sky-50/70 px-3 py-2">
      <div className="mb-1.5 flex items-center">
        <h2 className="flex-1 text-[12px] font-semibold">처음이신가요? 3단계로 시작하세요</h2>
        <IconButton label="안내 닫기" size="sm" onClick={onDismiss} data-testid="onboarding-dismiss">
          <X className="size-3.5" />
        </IconButton>
      </div>
      <ol className="space-y-0.5">
        {STEPS.map((s) => (
          <li key={s.n} className={cn("flex items-start gap-2 text-[12px] leading-snug", s.n === step ? "text-foreground" : "text-muted-foreground")}>
            <span
              className={cn(
                "mt-px flex size-4 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                s.n < step ? "bg-emerald-600 text-white" : s.n === step ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground",
              )}
            >
              {s.n < step ? <Check className="size-3" /> : s.n}
            </span>
            <span>
              <b className="font-semibold">{s.title}</b> — {s.desc}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
