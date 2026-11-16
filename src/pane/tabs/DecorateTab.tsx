import { LEGEND_PRESETS, NORTH_PRESETS, NORTH_SIZES, SCALE_PRESETS, type Corner, type DecoPos } from "@/lib/decorations";
import { cn } from "@/lib/utils";
import type { DecoSettings } from "@/pane/model";
import { ColorInput, Field, Section, Segmented, Slider, Toggle } from "@/pane/ui";

const CORNERS: { id: Corner; label: string }[] = [
  { id: "tl", label: "왼쪽 위" },
  { id: "tr", label: "오른쪽 위" },
  { id: "bl", label: "왼쪽 아래" },
  { id: "br", label: "오른쪽 아래" },
];

/** 지도 영역을 본뜬 작은 도식 — 네 모서리를 눌러 위치를 고른다 (현재 위치는 채워서 표시) */
function PosEditor({ pos, onChange }: { pos: DecoPos; onChange: (p: DecoPos) => void }) {
  const cur = CORNERS.find((c) => c.id === pos.corner)?.label ?? "";
  return (
    <>
      <Field label="위치">
        <div className="flex items-center gap-2">
          <div role="group" aria-label="꾸미기 위치" className="relative h-[60px] w-[104px] shrink-0 rounded-md border border-border bg-secondary/60 shadow-inner">
            {CORNERS.map((c) => {
              const on = pos.corner === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  title={c.label}
                  aria-label={c.label}
                  aria-pressed={on}
                  onClick={() => onChange({ ...pos, corner: c.id })}
                  className={cn(
                    "absolute flex h-[22px] w-[30px] items-center justify-center rounded border transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                    on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:border-primary/50 hover:bg-accent",
                  )}
                  style={{ [c.id[0] === "t" ? "top" : "bottom"]: 4, [c.id[1] === "l" ? "left" : "right"]: 4 }}
                >
                  <span className={cn("size-1.5 rounded-sm", on ? "bg-primary-foreground" : "bg-muted-foreground/50")} />
                </button>
              );
            })}
          </div>
          <span className="text-[11px] leading-snug text-muted-foreground">
            {cur}
            <br />
            모서리를 눌러 바꿉니다
          </span>
        </div>
      </Field>
      <Field label="여백">
        <Slider value={pos.margin} min={0} max={80} step={2} unit="px" label="여백" onChange={(v) => onChange({ ...pos, margin: v })} />
      </Field>
    </>
  );
}

export function DecorateTab({ deco, onChange }: { deco: DecoSettings; onChange: (d: DecoSettings) => void }) {
  const n = deco.north;
  const s = deco.scale;
  const l = deco.legend;
  return (
    <div>
      <Section title="방위표" right={<Toggle checked={n.show} onChange={(v) => onChange({ ...deco, north: { ...n, show: v } })} testId="toggle-north" />}>
        {n.show && (
          <>
            <Field label="모양">
              <Segmented value={n.preset} onChange={(v) => onChange({ ...deco, north: { ...n, preset: v } })} options={NORTH_PRESETS} />
            </Field>
            <Field label="크기">
              <Segmented<string>
                value={(Object.entries(NORTH_SIZES).find(([, v]) => v === n.size)?.[0] ?? "") as string}
                onChange={(k) => onChange({ ...deco, north: { ...n, size: NORTH_SIZES[k as keyof typeof NORTH_SIZES] } })}
                options={[
                  { id: "S", label: "S" },
                  { id: "M", label: "M" },
                  { id: "L", label: "L" },
                ]}
              />
            </Field>
            <Field label="직접 크기">
              <Slider value={n.size} min={24} max={160} step={2} unit="px" onChange={(v) => onChange({ ...deco, north: { ...n, size: v } })} />
            </Field>
            <Field label="색">
              <ColorInput value={n.color} onChange={(c) => onChange({ ...deco, north: { ...n, color: c } })} />
            </Field>
            <PosEditor pos={n.pos} onChange={(pos) => onChange({ ...deco, north: { ...n, pos } })} />
          </>
        )}
      </Section>

      <Section title="축척" right={<Toggle checked={s.show} onChange={(v) => onChange({ ...deco, scale: { ...s, show: v } })} testId="toggle-scale" />}>
        {s.show && (
          <>
            <Field label="모양">
              <Segmented value={s.preset} onChange={(v) => onChange({ ...deco, scale: { ...s, preset: v } })} options={SCALE_PRESETS} />
            </Field>
            <Field label="색">
              <ColorInput value={s.color} onChange={(c) => onChange({ ...deco, scale: { ...s, color: c } })} />
            </Field>
            <PosEditor pos={s.pos} onChange={(pos) => onChange({ ...deco, scale: { ...s, pos } })} />
            <p className="text-[11px] leading-snug text-muted-foreground">축척은 지도 중심의 실제 거리로 계산합니다. 1:n 은 슬라이드를 100% 로 인쇄한다고 가정한 값입니다.</p>
          </>
        )}
      </Section>

      <Section title="범례" right={<Toggle checked={l.show} onChange={(v) => onChange({ ...deco, legend: { ...l, show: v } })} testId="toggle-legend" />}>
        {l.show && (
          <>
            <Field label="모양">
              <Segmented value={l.preset} onChange={(v) => onChange({ ...deco, legend: { ...l, preset: v } })} options={LEGEND_PRESETS} />
            </Field>
            <Field label="제목">
              <input
                value={l.title}
                onChange={(e) => onChange({ ...deco, legend: { ...l, title: e.target.value } })}
                placeholder="(제목 없음)"
                className="h-7 w-full rounded-md border border-border bg-background px-2 text-[12px]"
              />
            </Field>
            <PosEditor pos={l.pos} onChange={(pos) => onChange({ ...deco, legend: { ...l, pos } })} />
            <p className="text-[11px] leading-snug text-muted-foreground">보이는 레이어를 위에서부터 나열합니다. 색 분류 레이어는 값별로 풀어서 표시합니다.</p>
          </>
        )}
      </Section>
    </div>
  );
}
