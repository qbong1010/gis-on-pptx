# -*- coding: utf-8 -*-
"""검정/흰색 배경 두 장으로 투명 PNG(오버레이)를 복원한다.

픽셀 색 C, 알파 a 일 때
  검정 배경: B = a*C          흰색 배경: W = a*C + (1-a)*255
  => a = 1 - (W-B)/255,  C = B/a
"""
import numpy as np
from qgis.PyQt.QtGui import QImage


def _to_array(img):
    img = img.convertToFormat(QImage.Format_RGB32)
    w, h = img.width(), img.height()
    ptr = img.constBits()
    ptr.setsize(img.sizeInBytes())
    arr = np.frombuffer(ptr, dtype=np.uint8).reshape(h, img.bytesPerLine() // 4, 4)[:, :w, :]
    return arr[:, :, :3][:, :, ::-1].astype(np.float32)  # BGRA -> RGB


def make_alpha_png(black_path, white_path, out_path):
    b_img, w_img = QImage(black_path), QImage(white_path)
    if b_img.isNull() or w_img.isNull():
        raise RuntimeError("오버레이 원본 이미지를 읽을 수 없습니다.")
    if b_img.size() != w_img.size():
        raise RuntimeError("검정/흰색 이미지 크기가 다릅니다.")
    B, W = _to_array(b_img), _to_array(w_img)
    diff = np.clip(W - B, 0, 255).mean(axis=2)          # 0..255 (채널 평균)
    alpha = 1.0 - diff / 255.0
    safe = np.where(alpha > 1e-3, alpha, 1.0)[:, :, None]
    rgb = np.clip(B / safe, 0, 255)
    rgb[alpha <= 1e-3] = 0
    h, w = alpha.shape
    out = np.empty((h, w, 4), dtype=np.uint8)           # QImage Format_ARGB32 = BGRA 바이트 순서
    out[:, :, 0] = rgb[:, :, 2]
    out[:, :, 1] = rgb[:, :, 1]
    out[:, :, 2] = rgb[:, :, 0]
    out[:, :, 3] = np.clip(alpha * 255 + 0.5, 0, 255)
    img = QImage(out.data, w, h, w * 4, QImage.Format_ARGB32).copy()
    if not img.save(out_path, "PNG"):
        raise RuntimeError("오버레이 PNG 저장 실패: " + out_path)
    return out_path
