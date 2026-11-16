# -*- coding: utf-8 -*-
"""PowerPoint 없이 .pptx(zip/XML)에서 슬라이드 목록과 Slide Map 프레임을 읽는다 (COM 대체 경로).

한계: 슬라이드 이미지는 만들 수 없다 (렌더링은 PowerPoint 필요). 프레임 위치 확인/목록용.
"""
import posixpath
import re
import zipfile
import xml.etree.ElementTree as ET

NS = {
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
}
EMU_PER_PT = 12700.0


def _rels(z, part):
    d, f = posixpath.split(part)
    rp = posixpath.join(d, "_rels", f + ".rels")
    out = {}
    if rp in z.namelist():
        for r in ET.fromstring(z.read(rp)).findall("rel:Relationship", NS):
            out[r.get("Id")] = posixpath.normpath(posixpath.join(d, r.get("Target")))
    return out


def _tags(z, rels, shape_el):
    tags = {}
    t = shape_el.find(".//p:custDataLst/p:tags", NS)
    if t is None:
        return tags
    target = rels.get(t.get("{%s}id" % NS["r"]))
    if target and target in z.namelist():
        for tg in ET.fromstring(z.read(target)).findall("p:tag", NS):
            tags[tg.get("name")] = tg.get("val")
    return tags


def read_pptx(path):
    """반환: {slideWidth, slideHeight, slides:[{index,id,title,shapes:[...]}]}  (단위 pt)"""
    with zipfile.ZipFile(path) as z:
        pres = ET.fromstring(z.read("ppt/presentation.xml"))
        sz = pres.find("p:sldSz", NS)
        prels = _rels(z, "ppt/presentation.xml")
        slides = []
        for i, sid in enumerate(pres.findall("p:sldIdLst/p:sldId", NS), 1):
            part = prels.get(sid.get("{%s}id" % NS["r"]))
            root = ET.fromstring(z.read(part))
            rels = _rels(z, part)
            shapes, title = [], ""
            for el in root.find("p:cSld/p:spTree", NS):
                tag = el.tag.split("}")[1]
                if tag not in ("sp", "pic", "graphicFrame", "grpSp", "cxnSp"):
                    continue
                c = el.find(".//p:cNvPr", NS)
                xf = el.find(".//a:xfrm", NS)
                if xf is None:
                    xf = el.find("p:xfrm", NS)
                if c is None or xf is None or xf.find("a:off", NS) is None:
                    continue
                off, ext = xf.find("a:off", NS), xf.find("a:ext", NS)
                tags = _tags(z, rels, el)
                ph = el.find(".//p:ph", NS)
                text = "".join(t.text or "" for t in el.iter("{%s}t" % NS["a"])).strip()
                if not title and text and (ph is None or ph.get("type") in (None, "title", "ctrTitle")):
                    title = text
                shapes.append({
                    "name": c.get("name"), "type": 13 if tag == "pic" else 1,
                    "left": int(off.get("x")) / EMU_PER_PT, "top": int(off.get("y")) / EMU_PER_PT,
                    "width": int(ext.get("cx")) / EMU_PER_PT, "height": int(ext.get("cy")) / EMU_PER_PT,
                    "part": tags.get("SLIDEMAP_PART", ""), "mapId": tags.get("SLIDEMAP_MAP", ""),
                    "z": len(shapes) + 1,
                })
            slides.append({"index": i, "id": int(sid.get("id")), "title": title, "shapes": shapes})
        return {"slideWidth": int(sz.get("cx")) / EMU_PER_PT, "slideHeight": int(sz.get("cy")) / EMU_PER_PT,
                "slides": slides}
