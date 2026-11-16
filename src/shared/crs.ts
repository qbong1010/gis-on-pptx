import L from "leaflet";

/**
 * "지도 해상도 배율"
 * 일반 웹지도는 타일 1장 = 256px 로 그린다. 여기서는 256 × tileScale 로 그리는 CRS 를 만든다.
 *  - tileScale 0.7 → 같은 줌 레벨의 타일을 70% 크기로 그림 → 글자·아이콘이 70% 크기
 *  - 배율을 바꿀 때는 화면에 보이는 지리적 범위가 유지되도록 줌을 보정한다 (zoomForScaleChange)
 * 지리 좌표 ↔ 화면 좌표 변환은 Leaflet 이 이 CRS 로 일관되게 처리하므로 GeoJSON 위치는 정확하다.
 */
export function tilePx(tileScale: number): number {
  return Math.max(64, Math.round(256 * tileScale));
}

export function makeScaledCRS(tileScale: number): L.CRS {
  const size = tilePx(tileScale);
  return L.extend({}, L.CRS.EPSG3857, {
    scale: (zoom: number) => size * Math.pow(2, zoom),
    zoom: (scale: number) => Math.log(scale / size) / Math.LN2,
  }) as L.CRS;
}

/** 배율 변경 시 같은 지상 해상도(m/px)를 유지하는 새 줌 */
export function zoomForScaleChange(zoom: number, fromScale: number, toScale: number): number {
  return zoom + Math.log2(tilePx(fromScale) / tilePx(toScale));
}
