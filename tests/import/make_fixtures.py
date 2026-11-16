"""
가져오기 테스트 픽스처 생성 (QGIS 3.34.10 에 포함된 GDAL 사용)
  python tests/import/make_fixtures.py
산출물: samples/gpkg-test/*.gpkg, samples/dxf-test/*.dxf  (각 1MB 미만)
"""
import json
import os
import re
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
Q = r"C:\Program Files\QGIS 3.34.10"
ENV = dict(os.environ)
ENV["PATH"] = Q + r"\bin;" + ENV["PATH"]
ENV["GDAL_DATA"] = Q + r"\apps\gdal\share\gdal"
ENV["PROJ_LIB"] = Q + r"\share\proj"
OGR = Q + r"\bin\ogr2ogr.exe"

SHP = os.path.join(ROOT, "samples", "shp-test")
GPKG = os.path.join(ROOT, "samples", "gpkg-test")
DXF = os.path.join(ROOT, "samples", "dxf-test")
TMP = os.path.join(ROOT, "tests", "import", "_tmp")
for d in (GPKG, DXF, TMP):
    os.makedirs(d, exist_ok=True)


def ogr(*args):
    r = subprocess.run([OGR, *args], env=ENV, capture_output=True)
    if r.returncode != 0:
        sys.exit("ogr2ogr 실패: %s\n%s" % (args, r.stderr.decode("utf8", "replace")))
    return r


def rm(p):
    if os.path.exists(p):
        os.remove(p)


# ---- 합성 원천 데이터 (WGS84, 서울 시청 부근) ----
pts = {
    "type": "FeatureCollection",
    "features": [
        {"type": "Feature", "properties": {"이름": "시청", "번호": i}, "geometry": {"type": "Point", "coordinates": [126.978 + i * 0.001, 37.5665 + i * 0.0007]}}
        for i in range(5)
    ],
}
holes = {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {"이름": "구멍면"},
            "geometry": {
                "type": "MultiPolygon",
                "coordinates": [
                    [
                        [[126.97, 37.56], [126.99, 37.56], [126.99, 37.58], [126.97, 37.58], [126.97, 37.56]],
                        [[126.975, 37.565], [126.98, 37.565], [126.98, 37.57], [126.975, 37.57], [126.975, 37.565]],
                    ],
                    [[[127.0, 37.56], [127.01, 37.56], [127.005, 37.575], [127.0, 37.56]]],
                ],
            },
        }
    ],
}
lines = {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {"이름": "복합선"},
            "geometry": {"type": "MultiLineString", "coordinates": [[[126.97, 37.55], [126.98, 37.552], [126.99, 37.55]], [[126.97, 37.545], [126.99, 37.545]]]},
        }
    ],
}
for n, d in (("pts", pts), ("holes", holes), ("lines", lines)):
    with open(os.path.join(TMP, n + ".geojson"), "w", encoding="utf8") as f:
        json.dump(d, f, ensure_ascii=False)

P = lambda n: os.path.join(TMP, n + ".geojson")

# ---- GPKG: 다중 테이블, 테이블별 다른 SRS (5186 x 4, 5174 x 1) ----
out = os.path.join(GPKG, "multi_5186.gpkg")
rm(out)
ogr("-f", "GPKG", out, os.path.join(SHP, "계획구역_5186.shp"), "-nln", "계획구역", "-lco", "SPATIAL_INDEX=NO", "--config", "SHAPE_ENCODING", "CP949")
for src, nln, extra in (
    (os.path.join(SHP, "도로_prj없음_5186.shp"), "도로", ["-a_srs", "EPSG:5186"]),
    (P("pts"), "지점", ["-t_srs", "EPSG:5186"]),
    (P("holes"), "구멍면", ["-t_srs", "EPSG:5186"]),
    (P("lines"), "복합선", ["-t_srs", "EPSG:5186"]),
    (os.path.join(SHP, "지적_5174.shp"), "지적_5174", []),
):
    ogr("-f", "GPKG", "-update", "-append", out, src, "-nln", nln, "-lco", "SPATIAL_INDEX=NO", "--config", "SHAPE_ENCODING", "CP949", *extra)

# ---- GPKG: WGS84 ----
out = os.path.join(GPKG, "wgs84.gpkg")
rm(out)
ogr("-f", "GPKG", out, P("pts"), "-nln", "지점", "-lco", "SPATIAL_INDEX=NO")
ogr("-f", "GPKG", "-update", "-append", out, P("holes"), "-nln", "구멍면", "-lco", "SPATIAL_INDEX=NO")

# ---- DXF (5186): 선 / 면(HATCH) / 점 / 라벨(MTEXT) ----
label = {
    "type": "FeatureCollection",
    "features": [
        {"type": "Feature", "properties": {"OGR_STYLE": 'LABEL(t:"시청 한글라벨",s:5g)'}, "geometry": {"type": "Point", "coordinates": [126.9785, 37.5668]}},
    ],
}
combined = {"type": "FeatureCollection", "features": []}
for d in (lines, holes, pts, label):
    combined["features"] += d["features"]
for ft in combined["features"]:
    ft["properties"] = {k: v for k, v in ft["properties"].items() if k == "OGR_STYLE"}
with open(os.path.join(TMP, "combined.geojson"), "w", encoding="utf8") as f:
    json.dump(combined, f, ensure_ascii=False)
dxf5186 = os.path.join(DXF, "drawing_5186.dxf")
rm(dxf5186)
ogr("-f", "DXF", dxf5186, os.path.join(TMP, "combined.geojson"), "-t_srs", "EPSG:5186")

# ---- DXF: CP949 변형 (\U+XXXX 이스케이프를 CP949 원문으로 되돌리고 $DWGCODEPAGE 지정) ----
raw = open(dxf5186, "rb").read().decode("latin1")
raw = re.sub(r"\\U\+([0-9a-fA-F]{4})", lambda m: chr(int(m.group(1), 16)), raw)
raw = raw.replace("ANSI_1252", "ANSI_949")
if "ANSI_949" not in raw:
    # 헤더에 코드페이지가 없으면 추가
    raw = raw.replace("$ACADVER", "$DWGCODEPAGE\r\n  3\r\nANSI_949\r\n  9\r\n$ACADVER", 1)
open(os.path.join(DXF, "drawing_5186_cp949.dxf"), "wb").write(raw.encode("cp949"))
print("ok")
for d in (GPKG, DXF):
    for n in sorted(os.listdir(d)):
        print(n, os.path.getsize(os.path.join(d, n)))
