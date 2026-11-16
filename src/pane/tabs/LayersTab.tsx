import { ArrowDown, ArrowUp, ChevronRight, Crosshair, Eye, EyeOff, FileUp, Layers, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useRef, useState } from "react";

import { CRS_LIST } from "@/lib/crs";
import { ACCEPT_ATTR } from "@/lib/importers";
import type { LayerStyle } from "@/lib/style";
import { cn } from "@/lib/utils";
import type { LayerMeta, MapDoc } from "@/pane/model";
import { LayerStyleEditor } from "@/pane/tabs/LayerStyleEditor";
import { EmptyState, IconButton, MenuItem, Popover, Select } from "@/pane/ui";

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
      aria-hidden
      className="inline-block size-4 shrink-0 rounded-[3px] border-2"
      style={{
        borderColor: l.kind === "point" ? "transparent" : s.strokeColor,
        borderStyle: s.dash === "solid" ? "solid" : "dashed",
        background: l.kind === "point" ? s.fillColor : fill,
        borderRadius: l.kind === "point" && s.pointShape === "circle" ? 999 : 3,
      }}
    />
  );
}

export function LayersTab(p: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null); // 삭제 확인 중인 레이어 id
  const layers = [...p.doc.layers].reverse(); // 위에 그려지는 레이어가 위쪽

  return (
    <div>
      <div className="px-3 pt-3">
        <input ref={fileRef} type="file" multiple accept={ACCEPT_ATTR} className="hidden" data-testid="file-input" onChange={(e) => e.target.files && p.onImport(e.target.files)} />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={p.importing}
          className="flex w-full flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-border bg-secondary/40 px-3 py-2.5 text-center transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60"
        >
          <span className="flex items-center gap-1.5 text-[12px] font-medium">
            <FileUp className="size-4" />
            {p.importing ? "가져오는 중…" : "파일 추가"}
          </span>
          <span className="text-[11px] text-muted-foreground">GeoJSON · SHP · ZIP · GPKG · DXF, 여기에 끌어다 놓아도 됩니다</span>
        </button>
        <div className="mt-2 flex items-center gap-2">
          <label htmlFor="crs-select" className="shrink-0 text-[11px] text-muted-foreground">
            입력 좌표계
          </label>
          <Select id="crs-select" value={p.crsOverride} onChange={(e) => p.setCrsOverride(e.target.value)} className="h-6">
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
          공공데이터 SHP(zip)나 GeoJSON 파일을 올리면 지도 위에 도형이 나타납니다.
        </EmptyState>
      ) : (
        <ul className="mt-3 border-t border-border" data-testid="layer-list">
          {layers.map((l, i) => {
            const isOpen = open === l.id;
            const asking = confirm === l.id;
            return (
              <li key={l.id} className="border-b border-border" data-layer-id={l.id}>
                {asking ? (
                  <div role="alertdialog" aria-label={`${l.name} 삭제 확인`} className="flex items-center gap-2 bg-red-50 px-3 py-2 text-[12px]">
                    <span className="min-w-0 flex-1">
                      <b className="font-semibold">{l.name}</b> 레이어를 삭제할까요?
                    </span>
                    <button
                      type="button"
                      data-testid="layer-delete-confirm"
                      onClick={() => {
                        setConfirm(null);
                        p.onRemove(l.id);
                      }}
                      className="rounded-md bg-destructive px-2 py-1 text-[12px] font-medium text-white hover:bg-destructive/90 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                    >
                      삭제
                    </button>
                    <button type="button" autoFocus onClick={() => setConfirm(null)} className="rounded-md border border-border bg-background px-2 py-1 text-[12px] hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring">
                      취소
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 px-2 py-1.5">
                    <IconButton label={isOpen ? "스타일 접기" : "스타일 펼치기"} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : l.id)} size="sm" className="text-muted-foreground">
                      <ChevronRight className={cn("size-3.5 transition-transform", isOpen && "rotate-90")} />
                    </IconButton>
                    <IconButton
                      label={l.visible ? `${l.name} 숨기기` : `${l.name} 보이기`}
                      aria-pressed={l.visible}
                      onClick={() => p.onPatch(l.id, { visible: !l.visible })}
                      className={cn(l.visible ? "text-foreground" : "text-muted-foreground")}
                    >
                      {l.visible ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                    </IconButton>
                    {swatch(l)}
                    <button
                      type="button"
                      onClick={() => setOpen(isOpen ? null : l.id)}
                      className={cn("min-w-0 flex-1 rounded px-1 text-left text-[12px] focus-visible:outline-2 focus-visible:outline-ring", !l.visible && "text-muted-foreground")}
                      title={`${l.name} (${l.featureCount.toLocaleString()}개)`}
                    >
                      <span className="block truncate">{l.name}</span>
                      <span className="block text-[11px] leading-tight text-muted-foreground">
                        {l.featureCount.toLocaleString()}개 · {l.kind === "polygon" ? "면" : l.kind === "line" ? "선" : l.kind === "point" ? "점" : "혼합"}
                      </span>
                    </button>
                    <Popover
                      trigger={({ toggle, open: o }) => (
                        <IconButton label={`${l.name} 메뉴`} aria-haspopup="menu" aria-expanded={o} onClick={toggle} data-testid="layer-menu">
                          <MoreHorizontal className="size-4" />
                        </IconButton>
                      )}
                    >
                      {(close) => (
                        <div role="menu">
                          <MenuItem icon={<Crosshair className="size-3.5" />} onClick={() => (close(), p.onZoom(l.id))}>
                            이 레이어로 이동
                          </MenuItem>
                          <MenuItem icon={<ArrowUp className="size-3.5" />} disabled={i === 0} onClick={() => (close(), p.onMove(l.id, 1))}>
                            위로 (위에 그려짐)
                          </MenuItem>
                          <MenuItem icon={<ArrowDown className="size-3.5" />} disabled={i === layers.length - 1} onClick={() => (close(), p.onMove(l.id, -1))}>
                            아래로
                          </MenuItem>
                          <MenuItem icon={<Pencil className="size-3.5" />} onClick={() => (close(), setOpen(l.id))}>
                            이름 바꾸기
                          </MenuItem>
                          <MenuItem danger icon={<Trash2 className="size-3.5" />} data-testid="layer-delete" onClick={() => (close(), setConfirm(l.id))}>
                            삭제…
                          </MenuItem>
                        </div>
                      )}
                    </Popover>
                  </div>
                )}
                {isOpen && !asking && (
                  <>
                    <div className="px-3 pb-2">
                      <input
                        value={l.name}
                        onChange={(e) => p.onPatch(l.id, { name: e.target.value })}
                        className="h-7 w-full rounded-md border border-border bg-background px-2 text-[12px] focus-visible:outline-2 focus-visible:outline-ring"
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
