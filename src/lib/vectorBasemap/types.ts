/** 벡터 배경지도 공용 타입 (순수 타입, 의존성 없음) */

export type Pt = [number, number]; // [lon, lat]

export type VectorGeometry = {
  type: "LineString" | "MultiLineString" | "Polygon" | "MultiPolygon";
  coordinates: unknown;
};

export type VectorFeatureProps = {
  /** 분류: 도로는 RoadClass, 토지/공원은 원본 class (grass, wood, school ...) */
  cls?: string;
  /** 세부 분류 (원본 subclass) */
  sub?: string;
  /** 행정경계 레벨 */
  admin?: number;
  /** 교량/터널 */
  brunnel?: "bridge" | "tunnel" | "ford";
};

/** GeoJSON 호환 Feature (lon/lat) */
export type VectorFeature = {
  type: "Feature";
  geometry: VectorGeometry;
  properties: VectorFeatureProps;
  /**
   * 폴리곤 전용(선택): 타일 클립 경계 위의 인공 변을 뺀 윤곽선. 폴리곤 파트별 선분 목록(lon/lat).
   * 첫==끝인 선분은 닫힌 링. 없으면 링 전체가 윤곽선. 테두리 선은 fill 경로와 분리해 이것으로 그린다.
   */
  outline?: Pt[][][];
};

export type RoadClass =
  | "motorway"
  | "trunk"
  | "primary"
  | "secondary"
  | "tertiary"
  | "minor"
  | "service"
  | "path"
  | "rail"
  | "transit";

export type VectorGroupName = "water" | "waterway" | "park" | "landuse" | "building" | "road" | "boundary" | "aeroway";

export type VectorLabelKind = "place" | "road" | "poi" | "water" | "peak";

export type VectorLabel = {
  text: string;
  lon: number;
  lat: number;
  kind: VectorLabelKind;
  /** 작을수록 중요 (원본 rank, 없으면 99) */
  rank: number;
  /** 도로명: fetch 시점의 대략 접선 각도(도). 정확한 각도는 bake 에서 투영 후 다시 계산 */
  angle?: number;
  /** place/poi/road 의 원본 class (city, quarter, subway, primary ...) */
  cls?: string;
  /** 도로명 라벨: 이 이름이 붙은 선형 (lon/lat). bake 에서 화면 투영 후 가장 긴 가시 구간에 라벨을 놓는다 */
  line?: Pt[];
};

export type VectorBasemapData = {
  groups: Record<string, VectorFeature[]>;
  labels: VectorLabel[];
  tileZoom: number;
  attribution: string;
  /** 요청 범위 */
  bounds: { west: number; south: number; east: number; north: number };
  /** 사용한 타일 수 / 실패한 타일 수 */
  tileCount: number;
  failedTiles: number;
};

export type VectorStyleId = "plan-gray" | "mono-line" | "color";

export type RoadStyle = {
  /** 확대 16 기준 폭 px (줌에 따라 자동 스케일) */
  width: number;
  color: string;
  /** 케이싱(외곽선) 색. 없으면 케이싱 안 그림 */
  casing?: string;
  /** 케이싱이 한쪽으로 더 나오는 두께 px (16 기준) */
  casingExtra?: number;
  /** 이 줌(화면 환산 줌) 이상일 때만 그림 */
  minZoom: number;
  dash?: string;
};

export type LabelStyle = {
  /** 기본 글자 크기 px (슬라이드 100% 기준) */
  size: number;
  color: string;
  /** 후광(halo) 색 */
  halo: string;
  /** 후광 두께 px (한쪽) */
  haloWidth: number;
  bold?: boolean;
  italic?: boolean;
};

export type VectorStyle = {
  id: VectorStyleId;
  name: string;
  background: string;
  water: { fill: string; stroke?: string; strokeWidth?: number };
  waterway: { stroke: string; width: number };
  park: { fill: string | null; wood?: string; pitch?: string; stroke?: string };
  /** landuse class -> 채움색 (null/없음 = 그리지 않음) */
  landuse: Record<string, string | null>;
  building: { fill: string | null; stroke: string | null; strokeWidth: number; minZoom: number };
  roads: Record<RoadClass, RoadStyle>;
  boundary: { color: string; width: number; dash: string; maxLevel: number };
  labels: Record<VectorLabelKind, LabelStyle>;
};
