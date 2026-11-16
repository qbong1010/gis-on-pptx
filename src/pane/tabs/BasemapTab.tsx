import { Settings2 } from "lucide-react";

import { BASEMAP_META } from "@/lib/basemaps";
import type { MapDoc } from "@/pane/model";
import { Field, Section, Segmented, Select } from "@/pane/ui";

const SCALES = [0.5, 0.7, 0.85, 1, 1.25];

type Props = {
  doc: MapDoc;
  vworldKey: string;
  onOpenSettings: () => void;
  onBasemap: (id: string) => void;
  onTileScale: (s: number) => void;
};

export function BasemapTab({ doc, vworldKey, onOpenSettings, onBasemap, onTileScale }: Props) {
  const cur = BASEMAP_META.find((b) => b.id === doc.settings.basemapId);
  const needKey = !!cur?.requiresKey && !vworldKey;

  return (
    <div>
      <Section title="배경지도">
        <Field label="종류" stack>
          <Select value={doc.settings.basemapId} onChange={(e) => onBasemap(e.target.value)} data-testid="basemap-select" aria-label="배경지도 종류">
            {BASEMAP_META.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
                {b.requiresKey && !vworldKey ? " (키 필요)" : ""}
              </option>
            ))}
          </Select>
        </Field>
        {needKey && (
          <div role="status" className="mt-1 rounded-md bg-amber-50 px-2 py-1.5 text-[11px] leading-snug text-amber-900">
            VWorld API 키가 없어 OpenStreetMap 으로 대체 표시됩니다.
            <button type="button" onClick={onOpenSettings} className="ml-1 inline-flex items-center gap-0.5 font-semibold underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring">
              <Settings2 className="size-3" />
              설정에서 키 입력
            </button>
          </div>
        )}
        <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">&quot;라벨 없음&quot; 지도 위에 데이터 라벨을 올리면 글자가 겹치지 않아 도면용으로 좋습니다.</p>
      </Section>

      <Section title="해상도 배율 (글자·아이콘 크기)">
        <Segmented<number> value={doc.settings.tileScale} onChange={onTileScale} options={SCALES.map((s) => ({ id: s, label: `${s}×` }))} />
        <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">작을수록 같은 범위에서 배경지도 글자가 작아집니다. 바꿔도 보이는 지리 범위는 유지됩니다.</p>
      </Section>
    </div>
  );
}
