/**
 * 가져오기 결과 레이어 공용 타입.
 * (v1 지도 박스 ↔ 패널 메시지 프로토콜은 D-042 에서 레거시 지도 박스와 함께 삭제됨)
 */
import type { BBox, FeatureCollection } from "geojson";

export type LayerInput = {
  id: string;
  name: string;
  /** WGS84 경위도 */
  data: FeatureCollection;
  bbox: BBox;
  featureCount: number;
};
