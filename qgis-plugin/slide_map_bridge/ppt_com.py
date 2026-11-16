# -*- coding: utf-8 -*-
"""PowerPoint COM 연동 (PowerShell 서브프로세스).

QGIS 번들 파이썬에는 pywin32가 없으므로, 동봉한 ppt_ops.ps1 을 powershell 로 실행하고
인자/결과를 UTF-8 JSON 파일로 주고받는다 (콘솔 인코딩 문제 회피, 콘솔 창 숨김).
Qt/QGIS에 의존하지 않아 단독 테스트가 가능하다 (overlay 변환만 QImage 필요).
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid

_HERE = os.path.dirname(os.path.abspath(__file__))
PS_SCRIPT = os.path.join(_HERE, "ppt_ops.ps1")

# 슬라이드 맵 프레임으로 인정하는 파트
FRAME_PARTS = ("basemap", "frame")

MAX_SCALE = 4.0   # 배경/오버레이 이미지 배율 상한 (슬라이드 pt 대비)
DEFAULT_TIMEOUT = 60
TIMEOUT_MSG = ("PowerPoint 응답 시간 초과 (%d초). PowerPoint에 열려 있는 대화상자(저장, 보호된 보기, 오류 등)가 "
               "작업을 막고 있지 않은지 확인하세요.")
_URL_RE = re.compile(r"^[A-Za-z][A-Za-z0-9+.\-]*://")


class PptError(RuntimeError):
    pass


class PptCancelled(PptError):
    """사용자가 작업을 취소함 (오류로 표시하지 않는다)."""


def clamp_scale(scale):
    try:
        v = float(scale)
    except (TypeError, ValueError):
        v = 3.0
    return max(1.0, min(MAX_SCALE, v))


def is_url(path):
    """OneDrive/SharePoint 문서는 FullName 이 https URL 이다."""
    return bool(_URL_RE.match(path or ""))


def safe_name(name, default="item"):
    """파일/폴더 이름 한 조각으로 안전하게: 경로 구분자(\\ /), '..', 예약 문자, 제어문자 제거."""
    s = re.sub(r'[\\/:*?"<>|\x00-\x1f]+', "_", name or "")
    s = re.sub(r"\.{2,}", "_", s)
    s = s.strip(" ._")
    if re.match(r"^(con|prn|aux|nul|com\d|lpt\d)$", s, re.I):
        s = "_" + s
    return s or default


def _powershell_exe():
    """QGIS 환경은 PATH가 축소돼 있어 powershell을 절대경로로 찾는다."""
    root = os.environ.get("SystemRoot") or r"C:\Windows"
    p = os.path.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    return p if os.path.exists(p) else "powershell"


def cache_dir():
    """이미지 캐시 폴더. 조판이 이미지 경로를 참조하므로 임시 폴더가 아닌 영구 위치를 쓴다."""
    base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
    d = os.path.join(base, "SlideMapBridge", "cache")
    os.makedirs(d, exist_ok=True)
    return d


def remove_cache_subdir(path):
    """캐시 폴더 '아래'의 하위 폴더만 삭제 (캐시 밖/캐시 루트는 절대 지우지 않는다)."""
    if not path:
        return False
    try:
        root = os.path.normcase(os.path.abspath(cache_dir()))
        p = os.path.normcase(os.path.abspath(path))
        if p == root or os.path.commonpath([root, p]) != root:
            return False
        shutil.rmtree(p, ignore_errors=True)
        return True
    except (ValueError, OSError):
        return False


def _decode(b):
    """PowerShell stderr: UTF-8 이 아니면 시스템 코드페이지(mbcs/cp949)로 해석."""
    if not b:
        return ""
    try:
        return b.decode("utf-8")
    except UnicodeDecodeError:
        try:
            return b.decode("mbcs")
        except (LookupError, UnicodeDecodeError):
            return b.decode("utf-8", "replace")


def _reap(proc, tmp):
    """취소 후 남은 프로세스가 끝나면 임시 폴더를 정리 (백그라운드)."""
    def work():
        try:
            proc.wait(timeout=120)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
        shutil.rmtree(tmp, ignore_errors=True)
    threading.Thread(target=work, daemon=True).start()


def run_op(op, timeout=DEFAULT_TIMEOUT, cancel=None, **params):
    """ppt_ops.ps1 의 op 실행. 실패하면 PptError, cancel() 이 True 가 되면 PptCancelled.

    cancel 로 중단하면 기다리기만 멈춘다 (PowerShell 은 COM 작업을 끝까지 마치고 스스로 정리한다).
    """
    if sys.platform != "win32":
        raise PptError("PowerPoint COM 연동은 Windows 전용입니다.")
    tmp = tempfile.mkdtemp(prefix="smb_")
    keep_tmp = False
    try:
        args_file = os.path.join(tmp, "args.json")
        out_file = os.path.join(tmp, "out.json")
        params["op"] = op
        with open(args_file, "w", encoding="utf-8") as f:
            json.dump(params, f, ensure_ascii=False)
        cmd = [_powershell_exe(), "-NoProfile", "-ExecutionPolicy", "Bypass",
               "-File", PS_SCRIPT, "-ArgsFile", args_file, "-OutFile", out_file]
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                stdin=subprocess.DEVNULL, creationflags=flags)
        deadline = time.monotonic() + timeout
        while True:
            try:
                _, stderr = proc.communicate(timeout=0.25)
                break
            except subprocess.TimeoutExpired:
                if cancel is not None and cancel():
                    keep_tmp = True
                    _reap(proc, tmp)
                    raise PptCancelled("취소되었습니다.")
                if time.monotonic() > deadline:
                    proc.kill()
                    proc.communicate()
                    raise PptError(TIMEOUT_MSG % timeout)
        if not os.path.exists(out_file):
            raise PptError("PowerShell 실행 실패: " + _decode(stderr).strip()[:500])
        try:
            with open(out_file, "r", encoding="utf-8-sig") as f:
                res = json.load(f)
        except (OSError, ValueError) as e:
            raise PptError("PowerShell 결과를 읽을 수 없습니다: %s" % e)
        if not res.get("ok"):
            raise PptError(res.get("error") or "알 수 없는 오류")
        return res
    finally:
        if not keep_tmp:
            shutil.rmtree(tmp, ignore_errors=True)


def _as_list(v):
    # PowerShell ConvertTo-Json 은 요소가 1개인 배열을 객체로 풀어 쓴다 -> 보정
    if v is None:
        return []
    return v if isinstance(v, list) else [v]


def is_running():
    return bool(run_op("ping", timeout=30).get("running"))


def _fix_slides(slides):
    slides = _as_list(slides)
    for sl in slides:
        if "shapes" in sl:
            sl["shapes"] = _as_list(sl["shapes"])
    return slides


def list_presentations(with_shapes=False, cancel=None):
    """열린 프레젠테이션 목록. with_shapes=True 면 슬라이드마다 도형 정보도 한 번에 가져온다."""
    res = run_op("list", cancel=cancel, withShapes=bool(with_shapes))
    pres = _as_list(res.get("presentations"))
    for p in pres:
        p["slides"] = _fix_slides(p.get("slides"))
    return pres


def list_slides(path, with_shapes=False, cancel=None):
    res = run_op("slides", cancel=cancel, path=path, withShapes=bool(with_shapes))
    res["slides"] = _fix_slides(res.get("slides"))
    return res


def slide_info(path, slide, slide_id=None, cancel=None):
    res = run_op("info", cancel=cancel, path=path, slide=int(slide), slideId=int(slide_id or 0))
    res["shapes"] = _as_list(res.get("shapes"))
    return res


def find_frame(shapes, shape_name=None):
    """Slide Map 프레임(basemap/frame 파트) 사각형을 찾는다.

    우선순위: 이름 지정 > basemap > frame > 가장 큰 그림(type 13) > None
    반환: (shape dict, 근거 문자열)
    """
    if shape_name:
        for s in shapes:
            if s["name"] == shape_name:
                return s, "name"
    for part in FRAME_PARTS:
        c = [s for s in shapes if s.get("part") == part]
        if c:
            return c[0], part
    pics = [s for s in shapes if s.get("type") == 13]
    if pics:
        return max(pics, key=lambda s: s["width"] * s["height"]), "largest-picture"
    return None, ""


def export_slide_images(path, slide, slide_w_pt, slide_h_pt, scale=3.0,
                        out_dir=None, want_overlay=True, above_z=0, slide_id=None, cancel=None):
    """슬라이드를 PNG로 내보낸다. 사용자 프레젠테이션은 건드리지 않는다
    (ppt_ops.ps1 이 사본을 만들어 사본에서만 객체 숨김/배경 변경 후 내보낸다).

    반환 dict: full(전체), nomap(지도 객체 숨김), overlay(지도 객체 숨김+투명 배경, 없으면 None)
    above_z: 이 z-order 이하(프레임 포함, 보통 프레임 z)의 객체는 오버레이에서 뺀다 (지도 뒤쪽 패널이 지도를 덮지 않도록).
    PowerPoint의 Slide.Export PNG는 배경을 불투명하게 채우므로, 오버레이는
    검정/흰색 배경으로 두 번 내보낸 뒤 알파를 복원한다 (overlay.py 참고).
    """
    scale = clamp_scale(scale)
    out_dir = out_dir or os.path.join(cache_dir(), uuid.uuid4().hex[:8])
    os.makedirs(out_dir, exist_ok=True)
    px_w, px_h = int(round(slide_w_pt * scale)), int(round(slide_h_pt * scale))
    paths = {
        "full": os.path.join(out_dir, "slide_full.png"),
        "nomap": os.path.join(out_dir, "slide_nomap.png"),
    }
    params = dict(path=path, slide=int(slide), slideId=int(slide_id or 0), pxWidth=px_w, pxHeight=px_h,
                  full=paths["full"], nomap=paths["nomap"])
    black = white = None
    if want_overlay:
        black = os.path.join(out_dir, "_ov_black.png")
        white = os.path.join(out_dir, "_ov_white.png")
        params.update(overlayBlack=black, overlayWhite=white, aboveZ=int(above_z))
    run_op("export", cancel=cancel, **params)
    overlay = None
    if want_overlay:
        from . import overlay as ov  # noqa: 지연 import (QImage 필요)
        overlay = os.path.join(out_dir, "slide_overlay.png")
        try:
            ov.make_alpha_png(black, white, overlay)
        finally:
            for p in (black, white):
                try:
                    os.remove(p)
                except OSError:
                    pass
    return {"full": paths["full"], "nomap": paths["nomap"], "overlay": overlay,
            "pxWidth": px_w, "pxHeight": px_h, "dir": out_dir}


def insert_picture(path, slide, image, left, top, width, height,
                   layout_name, map_id="", save=False, slide_id=None, qgis_id=""):
    """프레임 위치에 이미지를 넣고 SLIDEMAP_PART=qgis 태그 부여.

    이전 결과는 새 그림이 성공적으로 들어간 뒤에 교체한다 (qgis_id 가 같은 것, 태그 없는 구버전은 layout 이름).
    저장 요청은 읽기 전용/미저장 문서에선 건너뛰고 res['saved'], res['saveSkipped'] 로 알린다.
    """
    return run_op("insert", path=path, slide=int(slide), slideId=int(slide_id or 0), image=image,
                  left=left, top=top, width=width, height=height, layoutName=layout_name,
                  mapId=map_id or "", qgisId=qgis_id or "", save=bool(save))
