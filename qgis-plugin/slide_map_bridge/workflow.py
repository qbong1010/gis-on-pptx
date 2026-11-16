# -*- coding: utf-8 -*-
"""슬라이드 <-> 조판 작업 흐름 (GUI 비의존).

스레드 규칙: QGIS 프로젝트/조판 객체는 메인 스레드에서만 만진다.
  - COM 호출(느림)은 fetch_* / insert_prepared 로 분리해 백그라운드(QgsTask)에서 실행할 수 있고,
  - 조판 생성/수정/렌더링은 build_from_assets / apply_refresh / prepare_send 가 메인 스레드에서 한다.
  slide_to_layout / refresh_slide_images / send_to_slide 는 둘을 이어 붙인 동기 버전이다 (테스트용).
"""
import os
import uuid

from . import ppt_com, layout_builder as lb
from .ppt_com import safe_name


def _slug(s):
    return safe_name(s, "layout")


# ---------- 1. 슬라이드 -> 조판 ----------
def fetch_slide_assets(pptx_path, slide_index, frame_name=None, scale=3.0, slide_id=None, cancel=None):
    """[스레드 안전] 슬라이드 정보와 이미지(배경/오버레이)를 PowerPoint에서 가져온다."""
    scale = ppt_com.clamp_scale(scale)
    info = ppt_com.slide_info(pptx_path, slide_index, slide_id, cancel=cancel)
    sw, sh = info["slideWidth"], info["slideHeight"]
    frame_shape, basis = ppt_com.find_frame(info["shapes"], frame_name)
    above_z = frame_shape["z"] if frame_shape else 0
    pres_name = os.path.splitext(info["name"])[0]
    out_dir = os.path.join(ppt_com.cache_dir(), "%s_s%d_%s" % (_slug(pres_name), slide_index, uuid.uuid4().hex[:6]))
    try:
        imgs = ppt_com.export_slide_images(info["fullName"], slide_index, sw, sh, scale=scale,
                                           out_dir=out_dir, want_overlay=True, above_z=above_z,
                                           slide_id=info.get("slideId"), cancel=cancel)
    except BaseException:
        ppt_com.remove_cache_subdir(out_dir)
        raise
    return {"info": info, "frame_shape": frame_shape, "basis": basis, "images": imgs,
            "out_dir": out_dir, "scale": scale, "slide_index": slide_index, "pres_name": pres_name}


def build_from_assets(project, assets, extent=None, crs=None):
    """[메인 스레드] fetch_slide_assets 결과로 조판 생성. 반환: (layout, 보고용 dict)"""
    info, frame_shape, imgs = assets["info"], assets["frame_shape"], assets["images"]
    sw, sh = info["slideWidth"], info["slideHeight"]
    frame = None
    if frame_shape:
        frame = (frame_shape["left"], frame_shape["top"], frame_shape["width"], frame_shape["height"])
    spec = {
        "name": "슬라이드 %d - %s" % (assets["slide_index"], assets["pres_name"]),
        "slide_w_pt": sw, "slide_h_pt": sh, "frame": frame,
        "bg_image": imgs["nomap"], "overlay_image": imgs["overlay"],
        "link": {
            "pptx": info["fullName"], "slide_index": assets["slide_index"], "slide_id": info["slideId"],
            "map_id": (frame_shape or {}).get("mapId", ""), "frame_name": (frame_shape or {}).get("name", ""),
            "frame": list(frame) if frame else None, "slide_w_pt": sw, "slide_h_pt": sh,
            "cache_dir": assets["out_dir"], "scale": assets["scale"],
        },
    }
    layout = lb.build_layout(project, spec, extent=extent, crs=crs)
    layout.setCustomProperty(lb.PROP_PREFIX + "scale", str(assets["scale"]))
    return layout, {"frame_basis": assets["basis"] or "없음(페이지 여백)", "images": imgs, "info": info}


def slide_to_layout(project, pptx_path, slide_index, frame_name=None, scale=3.0,
                    extent=None, crs=None, slide_id=None):
    """슬라이드를 조판으로 재현 (동기). 반환: (layout, 보고용 dict)"""
    assets = fetch_slide_assets(pptx_path, slide_index, frame_name, scale, slide_id)
    return build_from_assets(project, assets, extent=extent, crs=crs)


# ---------- 2. 슬라이드 이미지 새로고침 ----------
def fetch_refresh_assets(link, layout_name, scale=3.0, cancel=None):
    """[스레드 안전] link = lb.get_link(layout) 사본. 새 이미지를 새 캐시 폴더로 내보낸다."""
    scale = ppt_com.clamp_scale(scale)
    info = ppt_com.slide_info(link["pptx"], link["slide_index"], link["slide_id"], cancel=cancel)
    shape, _ = ppt_com.find_frame(info["shapes"], link["frame_name"])
    above_z = shape["z"] if shape else 0
    out_dir = os.path.join(ppt_com.cache_dir(), "%s_r%s" % (_slug(layout_name), uuid.uuid4().hex[:6]))
    try:
        imgs = ppt_com.export_slide_images(info["fullName"], link["slide_index"], info["slideWidth"],
                                           info["slideHeight"], scale=scale, out_dir=out_dir,
                                           above_z=above_z, slide_id=info.get("slideId"), cancel=cancel)
    except BaseException:
        ppt_com.remove_cache_subdir(out_dir)
        raise
    return imgs


def apply_refresh(layout, imgs):
    """[메인 스레드] 배경/오버레이 이미지를 교체하고 이전 캐시 폴더를 삭제한다 (성공한 뒤에만)."""
    old_dirs = set()
    for item_id, key in ((lb.ID_BG, "nomap"), (lb.ID_OVERLAY, "overlay")):
        it = layout.itemById(item_id)
        if it is not None and imgs.get(key):
            if it.picturePath():
                old_dirs.add(os.path.dirname(it.picturePath()))
            it.setPicturePath(imgs[key])
            it.refresh()
    old_dirs.add(layout.customProperty(lb.PROP_PREFIX + "cache_dir", ""))
    layout.setCustomProperty(lb.PROP_PREFIX + "cache_dir", imgs["dir"])
    for d in old_dirs:
        if d and os.path.normcase(os.path.abspath(d)) != os.path.normcase(os.path.abspath(imgs["dir"])):
            ppt_com.remove_cache_subdir(d)


def refresh_slide_images(layout, scale=None):
    """연결된 슬라이드를 다시 내보내 배경/오버레이 이미지를 교체 (지도 항목은 그대로, 동기)."""
    link = lb.get_link(layout)
    if not link:
        raise ValueError("슬라이드와 연결된 조판이 아닙니다.")
    scale = scale or float(layout.customProperty("slidemap/scale", "3") or 3)
    imgs = fetch_refresh_assets(link, layout.name(), scale)
    apply_refresh(layout, imgs)
    return imgs


# ---------- 3. 조판 -> 슬라이드 ----------
def prepare_send(layout, dpi=300, fmt="png", transparent=False, include_others=False,
                 use_original_frame=False, out_dir=None):
    """[메인 스레드] 지도 항목을 이미지로 내보내고 삽입 인자를 만든다. (회전/다른 페이지 지도는 ValueError)"""
    link = lb.get_link(layout)
    if not link or not link["pptx"]:
        raise ValueError("슬라이드와 연결된 조판이 아닙니다. '슬라이드 -> 조판'으로 만든 조판에서 실행하세요.")
    # 위치/크기를 먼저 계산해 회전·페이지 문제를 렌더링 전에 거른다
    x, y, w_mm, h_mm = lb.map_rect_mm(layout)
    if use_original_frame and link["frame"]:
        l, t, w, h = link["frame"]
    else:  # 조판에서 지도 항목의 현재 위치/크기 (페이지 = 슬라이드 크기이므로 mm -> pt)
        l, t, w, h = lb.mm2pt(x), lb.mm2pt(y), lb.mm2pt(w_mm), lb.mm2pt(h_mm)
    qgis_id = lb.ensure_qgis_id(layout)
    out_dir = out_dir or os.path.join(ppt_com.cache_dir(), "send_" + _slug(layout.name()))
    os.makedirs(out_dir, exist_ok=True)
    ext = "svg" if fmt.lower() == "svg" else "png"
    out = os.path.join(out_dir, "map_%s.%s" % (uuid.uuid4().hex[:6], ext))
    size = lb.export_map(layout, out, fmt=ext, dpi=dpi, transparent=transparent,
                         include_others=include_others)
    return {"link": link, "layout_name": layout.name(), "qgis_id": qgis_id, "image": out,
            "px": size, "rect_pt": (l, t, w, h)}


def insert_prepared(prep, save=False, keep_image=False):
    """[스레드 안전] prepare_send 결과를 슬라이드에 삽입. 끝나면 임시 이미지를 지운다."""
    link, (l, t, w, h) = prep["link"], prep["rect_pt"]
    try:
        res = ppt_com.insert_picture(link["pptx"], link["slide_index"], prep["image"], l, t, w, h,
                                     prep["layout_name"], map_id=link["map_id"], save=save,
                                     slide_id=link["slide_id"], qgis_id=prep["qgis_id"])
    finally:
        if not keep_image:
            try:
                os.remove(prep["image"])
                os.rmdir(os.path.dirname(prep["image"]))  # 비었을 때만 삭제됨
            except OSError:
                pass
    res.update(image=prep["image"], px=prep["px"], rect_pt=prep["rect_pt"])
    warnings = []
    if save and not res.get("saved"):
        warnings.append("프레젠테이션을 저장하지 않았습니다: %s" % (res.get("saveSkipped") or "알 수 없는 이유"))
    res["warnings"] = warnings
    return res


def send_to_slide(layout, dpi=300, fmt="png", transparent=False, include_others=False,
                  use_original_frame=False, save=False, out_dir=None, keep_image=False):
    """조판의 지도 항목을 이미지로 내보내 연결된 슬라이드에 삽입 (동기). 반환: dict"""
    prep = prepare_send(layout, dpi, fmt, transparent, include_others, use_original_frame, out_dir)
    return insert_prepared(prep, save=save, keep_image=keep_image)
