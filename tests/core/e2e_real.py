"""실제 PowerPoint(WebView2 CDP 9229) E2E. 사용: python tests/core/e2e_real.py [basemap-id]
import faulthandler; faulthandler.dump_traceback_later(200, exit=True)
PowerPoint 가 열려 있고 작업창이 https://localhost:3000/taskpane.html 이어야 한다."""
import subprocess, sys, os, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "out")
SAMPLES = os.path.abspath(os.path.join(ROOT, "..", "..", "samples"))
BASEMAP = sys.argv[1] if len(sys.argv) > 1 else None
PS = os.path.join(ROOT, "com.ps1")

def com(action, arg=""):
    r = subprocess.run(["powershell", "-NoProfile", "-File", PS, action, arg], capture_output=True, text=True, encoding="utf-8", errors="replace")
    return (r.stdout or "").strip()

failed = False
def check(c, m):
    global failed
    print(("PASS " if c else "FAIL ") + m)
    failed = failed or not c

with sync_playwright() as p:
    b = p.chromium.connect_over_cdp("http://localhost:9229")
    page = [pg for c in b.contexts for pg in c.pages if "taskpane" in pg.url][0]
    page.on("console", lambda m: print("  CONSOLE", m.type, m.text[:200]) if m.type == "error" else None)
    print(com("clear"))
    page.evaluate("setTimeout(()=>location.reload(),50)"); time.sleep(3)
    page.wait_for_selector("[data-testid=add-map]")
    # 이전 실행의 지도를 문서 settings 에서 제거 (confirm 대화상자 회피)
    page.evaluate("""()=>{const s=Office.context.document.settings;const idx=s.get('slidemap.index');(idx&&idx.order||[]).forEach(id=>{const m=s.get('slidemap.map.'+id);((m&&m.layers)||[]).forEach(l=>s.remove('slidemap.layer.'+l.id));s.remove('slidemap.map.'+id)});s.remove('slidemap.index');s.saveAsync(()=>{});return 1}""")
    time.sleep(2)
    page.evaluate("setTimeout(()=>location.reload(),50)"); time.sleep(3)
    page.wait_for_selector("[data-testid=add-map]")
    page.locator("[data-testid=add-map]").dispatch_event("click")
    page.wait_for_function("document.querySelector('[data-testid=bake-result]').innerText.includes('개 객체')", timeout=60000)
    lst = com("list"); print(lst)
    check("basemap" in lst, "placeholder basemap on slide")
    if BASEMAP:
        page.locator("[data-tab=basemap]").dispatch_event("click")
        page.select_option("[data-testid=basemap-select]", BASEMAP)
        page.wait_for_timeout(2500)
    page.locator("[data-tab=layers]").dispatch_event("click")
    page.set_input_files("[data-testid=file-input]", [f"{SAMPLES}/shp-test/공공데이터_묶음.zip", f"{SAMPLES}/gangnam-sample.geojson"])
    page.wait_for_selector("[data-testid=layer-list] li", timeout=30000)
    page.wait_for_timeout(2500)
    # 첫(맨 위) 레이어에 라벨 필드 지정 + 프리셋
    li = page.locator("[data-testid=layer-list] > li").first
    li.locator("button[aria-label='스타일 펼치기']").dispatch_event("click")
    page.locator("button[title='빨간 굵은 점선, 채움 없음']").first.dispatch_event("click")
    sel = li.locator("select").nth(1)  # 색 분류 다음의 라벨 필드
    opts = li.locator("select").nth(1).locator("option").all_inner_texts()
    print("label fields", opts)
    if len(opts) > 1:
        li.locator("select").nth(1).select_option(index=1)
    page.locator("[data-testid=bake]").dispatch_event("click")
    page.wait_for_function("document.querySelector('[data-testid=bake-result]').innerText.includes('개 객체')", timeout=120000)
    page.wait_for_timeout(1500)
    print(page.inner_text("[data-testid=bake-result]"))
    lst = com("list"); print(lst)
    check("legend" in lst and "scale" in lst and "north" in lst, "decorations on slide")
    check(lst.count("|layer:") >= 2, "per-layer SVG shapes")
    print(com("export", os.path.join(OUT, f"real-1-baked{'-' + BASEMAP if BASEMAP else ''}.png")))
    before = com("list")
    print(com("move-north")); print(com("resize-basemap"))
    page.locator("[data-testid=bake]").dispatch_event("click")
    page.wait_for_function("document.querySelector('[data-testid=bake-result]').innerText.includes('바꾼 영역')", timeout=120000)
    page.wait_for_timeout(1500)
    after = com("list"); print(after)
    base = [l for l in after.splitlines() if "|basemap|" in l][0].split("|")
    north = [l for l in after.splitlines() if "|north|" in l][0].split("|")
    check(abs(float(base[2]) - 100) < 1 and abs(float(base[4]) - 760) < 1, f"frame adopted {base[2:6]}")
    check("|north|" in after and abs(float(north[2]) - float(before.split('north|')[1].split('|')[0]) + 150) < 1.5, f"north kept at {north[2:4]}")
    print(com("export", os.path.join(OUT, f"real-2-rebaked{'-' + BASEMAP if BASEMAP else ''}.png")))
    print(page.evaluate("window.__slidemapDiag.entries.slice(-12).map(e=>e.level+' '+e.text).join(' || ')"))
print("FAILED" if failed else "ALL PASSED")
