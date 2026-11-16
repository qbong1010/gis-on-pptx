# -*- coding: utf-8 -*-
"""슬라이드 사양 -> QGIS 인쇄 조판, 조판의 지도 항목 -> 이미지/SVG 내보내기.

GUI(iface)에 의존하지 않는다 (헤드리스 테스트 가능).

조판 항목 쌓임 순서 (아래 -> 위)
  1. 슬라이드 배경   : 지도 객체를 숨긴 슬라이드 전체 이미지 (잠금)
  2. 지도           : QGIS 지도 항목 (슬라이드 지도 프레임 위치/크기)
  3. 슬라이드 오버레이 : 지도 '위'에 놓일 카드/제목 등 (투명 PNG, 잠금)
  => 카드가 지도 위에 얹히는 실제 슬라이드와 같은 모습으로 가시성/선 굵기/글자 크기를 판단할 수 있다.
"""
import json
import os
import uuid

from qgis.core import (
    QgsLayoutItem, QgsLayoutItemMap, QgsLayoutItemPage, QgsLayoutItemPicture, QgsLayoutPoint, QgsLayoutSize,
    QgsPrintLayout, QgsProject, QgsUnitTypes, QgsLayoutExporter, QgsFillSymbol,
)
from qgis.PyQt.QtCore import QRectF, QSizeF

PT_TO_MM = 25.4 / 72.0
MM_TO_PT = 72.0 / 25.4

ID_BG = "슬라이드 배경"
ID_MAP = "지도"
ID_OVERLAY = "슬라이드 오버레이"
SLIDE_IMAGE_IDS = (ID_BG, ID_OVERLAY)

PROP_PREFIX = "slidemap/"


def pt2mm(v):
    return v * PT_TO_MM


def mm2pt(v):
    return v * MM_TO_PT


def _unique_name(manager, name):
    if manager.layoutByName(name) is None:
        return name
    i = 2
    while manager.layoutByName("%s (%d)" % (name, i)) is not None:
        i += 1
    return "%s (%d)" % (name, i)


def _add_picture(layout, item_id, path, x_mm, y_mm, w_mm, h_mm, locked=True):
    pic = QgsLayoutItemPicture(layout)
    pic.setId(item_id)
    pic.setResizeMode(QgsLayoutItemPicture.Stretch)
    pic.setPicturePath(path)
    layout.addLayoutItem(pic)
    pic.attemptMove(QgsLayoutPoint(x_mm, y_mm, QgsUnitTypes.LayoutMillimeters))
    pic.attemptResize(QgsLayoutSize(w_mm, h_mm, QgsUnitTypes.LayoutMillimeters))
    pic.setLocked(locked)
    return pic


def build_layout(project, spec, extent=None, crs=None):
    """조판 생성.

    spec (dict)
      name            조판 이름 (중복이면 ' (2)' 식으로 번호를 붙인다)
      slide_w_pt/h_pt 슬라이드 크기(pt)
      frame           (left, top, width, height) pt  - 지도 프레임. None이면 페이지 전체 여백 5%
      bg_image        지도 객체를 숨긴 슬라이드 PNG 경로 (선택)
      overlay_image   지도 위에 올릴 투명 PNG 경로 (선택)
      link            dict -> layout custom property (slidemap/<key>)
    extent: QgsRectangle (project CRS 기준), crs: QgsCoordinateReferenceSystem
    """
    manager = project.layoutManager()
    layout = QgsPrintLayout(project)
    layout.initializeDefaults()
    layout.setName(_unique_name(manager, spec["name"]))

    page_w, page_h = pt2mm(spec["slide_w_pt"]), pt2mm(spec["slide_h_pt"])
    layout.pageCollection().page(0).setPageSize(
        QgsLayoutSize(page_w, page_h, QgsUnitTypes.LayoutMillimeters))

    frame = spec.get("frame")
    if frame:
        fx, fy, fw, fh = [pt2mm(v) for v in frame]
    else:
        fx, fy, fw, fh = page_w * 0.05, page_h * 0.05, page_w * 0.9, page_h * 0.9

    if spec.get("bg_image"):
        _add_picture(layout, ID_BG, spec["bg_image"], 0, 0, page_w, page_h)

    m = QgsLayoutItemMap(layout)
    m.setId(ID_MAP)
    layout.addLayoutItem(m)
    m.attemptMove(QgsLayoutPoint(fx, fy, QgsUnitTypes.LayoutMillimeters))
    m.attemptResize(QgsLayoutSize(fw, fh, QgsUnitTypes.LayoutMillimeters))
    if crs is None:
        crs = project.crs()
    m.setCrs(crs)
    if extent is not None and not extent.isEmpty():
        m.zoomToExtent(extent)  # 항목 크기는 유지하고 종횡비에 맞춰 범위 조정
    m.setBackgroundEnabled(True)

    if spec.get("overlay_image"):
        _add_picture(layout, ID_OVERLAY, spec["overlay_image"], 0, 0, page_w, page_h)

    for k, v in (spec.get("link") or {}).items():
        layout.setCustomProperty(PROP_PREFIX + k, v if isinstance(v, str) else json.dumps(v))
    layout.setCustomProperty(PROP_PREFIX + "linked", "1")
    ensure_qgis_id(layout)
    manager.addLayout(layout)
    return layout


def ensure_qgis_id(layout):
    """슬라이드에서 이전 결과를 교체할 때 쓰는 고유 키 (이름이 같거나 바뀌어도 안전). 없으면 만든다."""
    qid = layout.customProperty(PROP_PREFIX + "qgis_id", "")
    if not qid:
        qid = uuid.uuid4().hex
        layout.setCustomProperty(PROP_PREFIX + "qgis_id", qid)
    return qid


def get_link(layout):
    """조판에 저장된 슬라이드 연결 정보. 연결 안 된 조판이면 None."""
    if layout.customProperty(PROP_PREFIX + "linked") != "1":
        return None
    g = lambda k, d="": layout.customProperty(PROP_PREFIX + k, d)
    try:
        frame = json.loads(g("frame", "null"))
    except ValueError:
        frame = None
    return {
        "pptx": g("pptx"), "slide_index": int(g("slide_index", "0") or 0),
        "slide_id": int(g("slide_id", "0") or 0), "map_id": g("map_id"), "qgis_id": g("qgis_id"),
        "frame_name": g("frame_name"), "frame": frame,
        "slide_w_pt": float(g("slide_w_pt", "0") or 0), "slide_h_pt": float(g("slide_h_pt", "0") or 0),
    }


def layout_items(layout):
    """layout.items() 에는 QGraphicsRectItem 등 비-조판 항목이 섞이므로 걸러낸다."""
    return [i for i in layout.items() if isinstance(i, QgsLayoutItem)]


def map_item(layout):
    """'지도' 항목 (없으면 첫 번째 지도 항목)."""
    m = layout.itemById(ID_MAP)
    if isinstance(m, QgsLayoutItemMap):
        return m
    for it in layout_items(layout):
        if isinstance(it, QgsLayoutItemMap):
            return it
    return None


def map_rect_mm(layout):
    """지도 항목의 (x, y, w, h) mm, 페이지 0 기준. 회전된 항목/다른 페이지의 항목은 거부한다."""
    m = map_item(layout)
    if m is None:
        raise ValueError("조판에 지도 항목이 없습니다.")
    if abs(m.itemRotation()) > 1e-6:
        raise ValueError("지도 항목이 회전되어 있습니다 (%.1f°). 슬라이드는 회전된 지도 이미지의 위치/크기를 "
                         "정확히 재현할 수 없으므로 회전을 0°로 되돌린 뒤 보내세요." % m.itemRotation())
    if m.page() != 0:
        raise ValueError("지도 항목이 첫 페이지에 있지 않습니다 (페이지 %d). 첫 페이지로 옮기세요." % (m.page() + 1))
    p = m.pos()
    s = m.rect().size()
    return p.x(), p.y(), s.width(), s.height()


def export_map(layout, out_path, fmt="png", dpi=300, transparent=False, include_others=False):
    """지도 항목 영역만 내보낸다.

    원본 조판은 건드리지 않고 layout.clone() 한 사본에서 작업한다:
      슬라이드 배경/오버레이 항목 제거, (include_others=False면 지도 외 항목도 제거),
      페이지 크기 = 지도 항목 크기로 줄이고 지도를 (0,0)으로 이동 -> 페이지 전체 내보내기.
    반환: (px_w, px_h) PNG면 실제 픽셀 크기, SVG면 (0,0)
    """
    src_map = map_item(layout)
    if src_map is None:
        raise ValueError("조판에 지도 항목이 없습니다.")
    mx, my, mw, mh = map_rect_mm(layout)
    c = layout.clone()
    try:
        # clone 에서 같은 항목 찾기: 지도는 uuid 대신 id로
        cmap = c.itemById(src_map.id()) if src_map.id() else None
        if cmap is None:
            cmap = next(i for i in layout_items(c) if isinstance(i, QgsLayoutItemMap))
        # 첫 페이지만 내보낸다 (나머지 페이지와 그 위의 항목은 삭제)
        pc = c.pageCollection()
        for i in range(pc.pageCount() - 1, 0, -1):
            pc.deletePage(i)
        for it in layout_items(c):
            if it is cmap or isinstance(it, QgsLayoutItemPage):
                continue
            if it.id() in SLIDE_IMAGE_IDS or not include_others:
                c.removeLayoutItem(it)
        # 남은 항목을 지도 좌상단 기준으로 이동
        for it in layout_items(c):
            if isinstance(it, QgsLayoutItemPage):
                continue
            p = it.pos()
            # pos() 는 항상 좌상단 좌표 -> 항목의 기준점(Middle/LowerRight 등) 설정과 무관하게 이동해야 하므로
            # useReferencePoint=False. (기본값 True 면 기준점 위치로 해석되어 어긋난다)
            it.attemptMove(QgsLayoutPoint(p.x() - mx, p.y() - my, QgsUnitTypes.LayoutMillimeters), False)
        page = c.pageCollection().page(0)
        page.setPageSize(QgsLayoutSize(mw, mh, QgsUnitTypes.LayoutMillimeters))
        if transparent:
            page.setPageStyleSymbol(QgsFillSymbol.createSimple(
                {"color": "0,0,0,0", "outline_style": "no"}))
            cmap.setBackgroundEnabled(False)
        exp = QgsLayoutExporter(c)
        fmt = fmt.lower()
        if fmt == "svg":
            s = QgsLayoutExporter.SvgExportSettings()
            s.dpi = dpi
            s.forceVectorOutput = True
            r = exp.exportToSvg(out_path, s)
            size = (0, 0)
        else:
            s = QgsLayoutExporter.ImageExportSettings()
            s.dpi = dpi
            r = exp.exportToImage(out_path, s)
            from qgis.PyQt.QtGui import QImage
            im = QImage(out_path)
            size = (im.width(), im.height())
        if r != QgsLayoutExporter.Success:
            raise RuntimeError("조판 내보내기 실패 (코드 %s)" % r)
        return size
    finally:
        del c
