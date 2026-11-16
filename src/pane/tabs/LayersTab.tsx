import { ArrowDown, ArrowUp, ChevronRight, Crosshair, Eye, EyeOff, FileUp, Layers, Trash2 } from "lucide-react";
import { useRef, useState } from "react";

import { CRS_LIST } from "@/lib/crs";
import { ACCEPT_ATTR } from "@/lib/importers";
import type { LayerStyle } from "@/lib/style";
import { cn } from "@/lib/utils";
import type { LayerMeta, MapDoc } from "@/pane/model";
import { LayerStyleEditor } from "@/pane/tabs/LayerStyleEditor";
import { EmptyState, Select } from "@/pane/ui";

type Props = {
  doc: MapDoc;
  importing: boolean;
  crsOverride: string;
  setCrsOverride: (c: string) => void;
  onImport: (files: FileList | File[]) => void;
  onPatch: (id: string, patch: Partial<LayerMeta>) => void;
  onStyle: (id: string, s: LayerStyle) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onRemove: (id: string) => void;
  onZoom: (id: string) => void;
};

function swatch(l: LayerMeta) {
  const s = l.style;
  const fill = l.kind === "line" ? "transparent" : s.fillOpacity > 0 ? s.fillColor : "transparent";
  return (
    <span
      className="inline-block size-4 shrink-0 rounded-[3px] border-2"
      style={{
        borderColor: l.kind === "point" ? "transparent" : s.strokeColor,
        borderStyle: s.dash === "solid" ? "solid" : "dashed",
        background: l.kind === "point" ? s.fillColor : fill,
        opacity: l.kind === "line" ? 1 : 1,
        borderRadius: l.kind === "point" && s.pointShape === "circle" ? 999 : 3,
      }}
    />
  );
}

export function LayersTab(p: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState<string | null>(null);
  const layers = [...p.doc.layers].reverse(); // 위에 그려지는 레이어가 위쪽

  return (
    <div>
      <div className="px-3 pt-3">
        <input ref={fileRef} type="file" multiple accept={ACCEPT_ATTR} className="hidden" data-testid="file-input" onChange={(e) => e.target.files && p.onImport(e.target.files)} />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={p.importing}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-secondary/40 px-3 py-3 text-[12px] text-muted-foreground transition-colors hover:bg-accent disabled:opacity-60"
        >
          <FileUp className="size-4" />
          {p.importing ? "가져오는 중…" : "파일 추가 (GeoJSON · SHP · ZIP) — 여기에 끌어다 놓아도 됩니다"}
        </button>
        <div className="mt-1.5 flex items-center gap-2">
          <span className="shrink-0 text-[11px] text-muted-foreground">입력 좌표계</span>
          <Select value={p.crsOverride} onChange={(e) => p.setCrsOverride(e.target.value)} className="h-6">
            <option value="auto">자동 (.prj / 경위도 추정)</option>
            {CRS_LIST.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} · {c.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {layers.length === 0 ? (
        <EmptyState icon={<Layers className="size-8" />} title="레이어가 없습니다">
          공공데이터 SHP(zip)나 GeoJSON 파일을 올리면
          <br />
          지도 위에 도형이 나타납니다.
        </EmptyState>
      ) : (
        <ul className="mt-2 border-t border-border" data-testid="layer-list">
          {layers.map((l, i) => {
            const isOpen = open === l.id;
            return (
              <li key={l.id} className="border-b border-border" data-layer-id={l.id}>
                <div className="flex items-center gap-1 px-2 py-1.5">
                  <button type="button" onClick={() => setOpen(isOpen ? null : l.id)} className="flex size-5 items-center justify-center text-muted-foreground" aria-label="스타일 펼치기">
                    <ChevronRight className={cn("size-3.5 transition-transform", isOpen && "rotate-90")} />
                  </button>
                  <button type="button" title={l.visible ? "숨기기" : "보이기"} onClick={() => p.onPatch(l.id, { visible: !l.visible })} className="flex size-6 items-center justify-center rounded hover:bg-accent">
                    {l.visible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5 text-muted-foreground" />}
                  </button>
                  {swatch(l)}
                  <button type="button" onClick={() => setOpen(isOpen ? null : l.id)} className={cn("min-w-0 flex-1 truncate text-left text-[12px]", !l.visible && "text-muted-foreground")} title={l.name}>
                    {l.name}
                    <span className="ml-1 text-[10px] text-muted-foreground">{l.featureCount.toLocaleString()}</span>
                  </button>
                  <button type="button" title="위로 (위에 그려짐)" disabled={i === 0} onClick={() => p.onMove(l.id, 1)} className="flex size-6 items-center justify-center rounded hover:bg-accent disabled:opacity-30">
                    <ArrowUp className="size-3.5" />
                  </button>
                  <button type="button" title="아래로" disabled={i === layers.length - 1} onClick={() => p.onMove(l.id, -1)} className="flex size-6 items-center justify-center rounded hover:bg-accent disabled:opacity-30">
                    <ArrowDown className="size-3.5" />
                  </button>
                  <button type="button" title="이 레이어로 이동" onClick={() => p.onZoom(l.id)} className="flex size-6 items-center justify-center rounded hover:bg-accent">
                    <Crosshair className="size-3.5" />
                  </button>
                  <button type="button" title="삭제" onClick={() => p.onRemove(l.id)} className="flex size-6 items-center justify-center rounded text-destructive hover:bg-accent">
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
                {isOpen && (
                  <>
                    <div className="px-3 pb-2">
                      <input
                        value={l.name}
                        onChange={(e) => p.onPatch(l.id, { name: e.target.value })}
                        className="h-7 w-full rounded-md border border-border bg-background px-2 text-[12px]"
                        aria-label="레이어 이름"
                      />
                    </div>
                    <LayerStyleEditor layer={l} onChange={(s) => p.onStyle(l.id, s)} />
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
