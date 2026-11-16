import { applyPreset, PALETTES, STYLE_PRESETS, type Dash, type LayerStyle, type PointShape } from "@/lib/style";
import type { LayerMeta } from "@/pane/model";
import { ColorInput, Field, Segmented, Select, Slider, Toggle } from "@/pane/ui";

/** 레이어 스타일 편집 (미리보기와 Bake 에 동일하게 적용) */
export function LayerStyleEditor({ layer, onChange }: { layer: LayerMeta; onChange: (s: LayerStyle) => void }) {
  const st = layer.style;
  const set = (patch: Partial<LayerStyle>) => onChange({ ...st, ...patch });
  const setLabel = (patch: Partial<LayerStyle["label"]>) => onChange({ ...st, label: { ...st.label, ...patch } });
  const hasPoly = layer.kind === "polygon" || layer.kind === "mixed";
  const hasPoint = layer.kind === "point" || layer.kind === "mixed";
  const hasLine = layer.kind !== "point";
  const catField = st.categoryField;

  return (
    <div className="space-y-2 border-t border-border bg-secondary/40 px-3 py-2.5">
      <div>
        <div className="mb-1 text-[11px] font-medium text-muted-foreground">스타일 프리셋</div>
        <div className="grid grid-cols-3 gap-1">
          {STYLE_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              title={p.hint}
              onClick={() => onChange(applyPreset(st, p))}
              className="truncate rounded-md border border-border bg-background px-1 py-1 text-[11px] hover:bg-accent"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {hasLine && (
        <>
          <Field label={hasPoly ? "윤곽선" : "선 색"}>
            <ColorInput value={st.strokeColor} onChange={(c) => set({ strokeColor: c })} />
          </Field>
          <Field label="선 굵기">
            <Slider value={st.strokeWidth} min={0} max={10} step={0.5} unit="px" onChange={(v) => set({ strokeWidth: v })} />
          </Field>
          <Field label="선 투명도">
            <Slider value={Math.round(st.strokeOpacity * 100)} min={0} max={100} step={5} unit="%" onChange={(v) => set({ strokeOpacity: v / 100 })} />
          </Field>
          <Field label="선 종류">
            <Segmented<Dash>
              value={st.dash}
              onChange={(v) => set({ dash: v })}
              options={[
                { id: "solid", label: "실선" },
                { id: "dash", label: "파선" },
                { id: "dot", label: "점선" },
                { id: "dashdot", label: "일점쇄선" },
              ]}
            />
          </Field>
        </>
      )}

      {(hasPoly || hasPoint) && (
        <>
          <Field label="채움 색">
            <ColorInput value={st.fillColor} onChange={(c) => set({ fillColor: c })} />
          </Field>
          <Field label="채움 투명도">
            <Slider value={Math.round(st.fillOpacity * 100)} min={0} max={100} step={5} unit="%" onChange={(v) => set({ fillOpacity: v / 100 })} />
          </Field>
        </>
      )}

      {hasPoint && (
        <>
          <Field label="점 크기">
            <Slider value={st.pointRadius} min={1} max={20} step={0.5} unit="px" onChange={(v) => set({ pointRadius: v })} />
          </Field>
          <Field label="점 모양">
            <Segmented<PointShape>
              value={st.pointShape}
              onChange={(v) => set({ pointShape: v })}
              options={[
                { id: "circle", label: "● 원" },
                { id: "square", label: "■ 사각" },
                { id: "triangle", label: "▲ 삼각" },
              ]}
            />
          </Field>
        </>
      )}

      <Field label="색 분류" hint={catField ? "속성값마다 다른 색 (값이 10개를 넘으면 '기타')" : undefined}>
        <div className="flex gap-1">
          <Select value={catField ?? ""} onChange={(e) => set({ categoryField: e.target.value || null })}>
            <option value="">단일 색</option>
            {layer.fields.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </Select>
          {catField && (
            <Select value={st.palette} onChange={(e) => set({ palette: e.target.value })} className="w-[84px] shrink-0">
              {Object.entries(PALETTES).map(([id, p]) => (
                <option key={id} value={id}>
                  {p.label}
                </option>
              ))}
            </Select>
          )}
        </div>
      </Field>

      <div className="border-t border-border pt-2">
        <div className="mb-0.5 text-[11px] font-medium text-muted-foreground">라벨</div>
        <Field label="표시 필드">
          <Select value={st.label.field ?? ""} onChange={(e) => setLabel({ field: e.target.value || null })}>
            <option value="">없음</option>
            {layer.fields.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </Select>
        </Field>
        {st.label.field && (
          <>
            <Field label="글자 크기">
              <Slider value={st.label.size} min={8} max={40} step={1} unit="px" onChange={(v) => setLabel({ size: v })} />
            </Field>
            <Field label="글자 색">
              <ColorInput value={st.label.color} onChange={(c) => setLabel({ color: c })} />
            </Field>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 pt-0.5">
              <Toggle checked={st.label.bold} onChange={(v) => setLabel({ bold: v })} label="굵게" />
              <Toggle checked={st.label.halo} onChange={(v) => setLabel({ halo: v })} label="흰 외곽선" />
              <Toggle
                checked={st.label.native}
                onChange={(v) => setLabel({ native: v })}
                label="PPT 텍스트 상자"
                testId="label-native"
              />
            </div>
            <p className="pt-0.5 text-[11px] leading-snug text-muted-foreground/80">
              텍스트 상자는 PowerPoint 에서 글자를 바로 고칠 수 있습니다(외곽선 없음). 끄면 SVG 글자로 들어갑니다.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
