import { Maximize2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { DecoSettings, Frame, MapDoc } from "@/pane/model";
import { Section, Toggle } from "@/pane/ui";
import type { SlideAdapter } from "@/pane/slide";

const RATIOS: { label: string; r: number }[] = [
  { label: "16:9", r: 16 / 9 },
  { label: "4:3", r: 4 / 3 },
  { label: "1:1", r: 1 },
  { label: "3:4", r: 3 / 4 },
];

type Props = {
  doc: MapDoc;
  adapter: SlideAdapter;
  slide: { width: number; height: number };
  onBake: (patch: Partial<MapDoc["bake"]>) => void;
  onDeco: (d: DecoSettings) => void;
  onFrame: (f: Frame) => void;
};

function Num({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
      <span className="w-6 shrink-0">{label}</span>
      <input
        type="number"
        value={Math.round(value * 10) / 10}
        onChange={(e) => Number.isFinite(e.target.valueAsNumber) && onChange(e.target.valueAsNumber)}
        className="h-7 w-full min-w-0 rounded-md border border-border bg-background px-1.5 text-[12px] text-foreground"
      />
    </label>
  );
}

export function BakeTab({ doc, adapter, slide, onBake, onDeco, onFrame }: Props) {
  const b = doc.bake;
  const f = doc.frame;
  const d = doc.deco;
  const setFrame = (patch: Partial<Frame>) => onFrame({ ...f, ...patch });
  const aspect = f.width / f.height;
  return (
    <div>
      <Section title="슬라이드에 넣을 것">
        <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
          <Toggle checked={b.basemap} onChange={(v) => onBake({ basemap: v })} label="배경지도" testId="bake-basemap" />
          <Toggle checked={b.shapes} onChange={(v) => onBake({ shapes: v })} label="도형" testId="bake-shapes" />
          <Toggle checked={b.labels} onChange={(v) => onBake({ labels: v })} label="라벨" testId="bake-labels" />
          <Toggle checked={d.north.show} onChange={(v) => onDeco({ ...d, north: { ...d.north, show: v } })} label="방위표" />
          <Toggle checked={d.scale.show} onChange={(v) => onDeco({ ...d, scale: { ...d.scale, show: v } })} label="축척" />
          <Toggle checked={d.legend.show} onChange={(v) => onDeco({ ...d, legend: { ...d.legend, show: v } })} label="범례" />
        </div>
      </Section>

      <Section title="방식">
        <Toggle checked={b.split} onChange={(v) => onBake({ split: v })} label="레이어별 분리 (레이어마다 SVG 한 장)" testId="bake-split" />
        <Toggle
          checked={b.group}
          onChange={(v) => onBake({ group: v })}
          label="묶기 (반영 후 하나로 그룹)"
          disabled={!adapter.caps.group}
          reason="이 PowerPoint 는 그룹 만들기(PowerPointApi 1.8)를 지원하지 않습니다."
          testId="bake-group"
        />
        <Toggle
          checked={b.basemapLabelsNative}
          onChange={(v) => onBake({ basemapLabelsNative: v })}
          label="배경지도 글자를 텍스트 상자로 (벡터 배경지도)"
          disabled={!adapter.caps.textBox}
          reason="이 PowerPoint 는 텍스트 상자 추가(PowerPointApi 1.4)를 지원하지 않습니다."
          testId="bake-bm-native"
        />
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
          다시 반영하면 같은 지도의 기존 객체를 교체합니다. 슬라이드에서 옮겨 둔 방위표·축척·범례 위치는 유지되고, 배경지도를 늘리거나 옮기면 그 영역이 새 지도 영역이 됩니다.
        </p>
      </Section>

      <Section title="지도 영역 (슬라이드 위 위치, pt)">
        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
          <Num label="X" value={f.left} onChange={(v) => setFrame({ left: v })} />
          <Num label="Y" value={f.top} onChange={(v) => setFrame({ top: v })} />
          <Num label="폭" value={f.width} onChange={(v) => v > 40 && setFrame({ width: v, height: v / aspect })} />
          <Num label="높이" value={f.height} onChange={(v) => v > 40 && setFrame({ height: v })} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {RATIOS.map((r) => (
            <Button key={r.label} variant="outline" size="sm" className="h-6 px-2 text-[11px]" onClick={() => setFrame({ height: Math.round(f.width / r.r) })}>
              {r.label}
            </Button>
          ))}
          <Button
            variant="outline"
            size="sm"
            className="h-6 gap-1 px-2 text-[11px]"
            title="슬라이드 전체 크기로"
            onClick={() => onFrame({ left: 0, top: 0, width: slide.width, height: slide.height })}
          >
            <Maximize2 className="size-3" />
            전체
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-[11px]"
            onClick={() => setFrame({ left: Math.round((slide.width - f.width) / 2), top: Math.round((slide.height - f.height) / 2) })}
          >
            중앙
          </Button>
        </div>
        <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
          슬라이드 {slide.width}×{slide.height}pt 기준. 글자·선 굵기는 슬라이드 100% 크기(1pt = 4/3px) 기준이라 영역을 키우면 더 넓은 범위가 보입니다.
        </p>
      </Section>
    </div>
  );
}
