import { KeyRound } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { BASEMAP_META, ENV_VWORLD_KEY } from "@/lib/basemaps";
import type { MapDoc } from "@/pane/model";
import { Field, Section, Segmented, Select } from "@/pane/ui";

const SCALES = [0.5, 0.7, 0.85, 1, 1.25];

type Props = {
  doc: MapDoc;
  vworldKey: string;
  onKey: (k: string) => void;
  onBasemap: (id: string) => void;
  onTileScale: (s: number) => void;
};

export function BasemapTab({ doc, vworldKey, onKey, onBasemap, onTileScale }: Props) {
  const [draft, setDraft] = useState(vworldKey);
  const cur = BASEMAP_META.find((b) => b.id === doc.settings.basemapId);
  const needKey = !!cur?.requiresKey && !vworldKey;

  return (
    <div>
      <Section title="배경지도">
        <Field label="종류" stack>
          <Select value={doc.settings.basemapId} onChange={(e) => onBasemap(e.target.value)} data-testid="basemap-select">
            {BASEMAP_META.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
                {b.requiresKey && !vworldKey ? " (키 필요)" : ""}
              </option>
            ))}
          </Select>
        </Field>
        {needKey && <p className="rounded-md bg-amber-50 px-2 py-1.5 text-[11px] leading-snug text-amber-800">VWorld API 키가 없어 OpenStreetMap 으로 대체 표시됩니다. 아래에서 키를 입력하세요.</p>}
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
          &quot;라벨 없음&quot; 지도 위에 데이터 라벨을 올리면 글자가 겹치지 않아 도면용으로 좋습니다.
        </p>
      </Section>

      <Section title="해상도 배율 (글자·아이콘 크기)">
        <Segmented<number> value={doc.settings.tileScale} onChange={onTileScale} options={SCALES.map((s) => ({ id: s, label: `${s}×` }))} />
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">작을수록 같은 범위에서 배경지도 글자가 작아집니다. 바꿔도 보이는 지리 범위는 유지됩니다.</p>
      </Section>

      <Section title="VWorld API 키" defaultOpen={needKey || !vworldKey}>
        <div className="flex gap-1">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="VWorld 인증키"
            className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-[12px]"
            data-testid="vworld-key"
          />
          <Button size="sm" variant="outline" className="h-7 px-2 text-[12px]" onClick={() => onKey(draft.trim())}>
            <KeyRound className="size-3.5" />
            저장
          </Button>
        </div>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
          {vworldKey ? "키가 저장되어 있습니다." : ENV_VWORLD_KEY ? "" : "https://www.vworld.kr 에서 발급받은 키를 입력합니다."}
        </p>
      </Section>
    </div>
  );
}
