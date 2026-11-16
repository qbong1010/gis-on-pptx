# Slide Map Bridge - PowerPoint COM 작업 스크립트
# 사용: powershell -File ppt_ops.ps1 -ArgsFile <json> -OutFile <json>
# 결과는 항상 UTF-8 JSON 파일(OutFile)로 쓴다 (콘솔 인코딩 문제 회피). 인자 파싱 실패도 파일로 보고한다.
#
# 원칙: 사용자의 프레젠테이션은 내보내기 때문에 절대 변경하지 않는다.
#   export 는 SaveCopyAs 로 임시 사본을 만들어 사본에서만 숨김/배경 변경 후 내보내고,
#   사본은 저장 없이 닫고 임시 파일을 지운다 (모두 finally).
param([string]$ArgsFile, [string]$OutFile)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
$result = @{ ok = $true }
$script:opened = $null    # 이 스크립트가 직접 연 (원본) 프레젠테이션 - 끝나면 닫는다
$script:copy = $null      # export 용 임시 사본
$script:tmpFiles = @()    # 지워야 할 임시 파일
$COPY_PREFIX = 'smb_export_'

function Get-App {
    try { return [Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application') }
    catch { return $null }
}
function Get-Tag($shape, $name) {
    try { return [string]$shape.Tags.Item($name) } catch { return '' }
}
function Is-SlideMap($shape) {
    return ((Get-Tag $shape 'SLIDEMAP_PART') -ne '') -or ((Get-Tag $shape 'SLIDEMAP_MAP') -ne '')
}
function Is-Url($s) { return ([string]$s -match '^[A-Za-z][A-Za-z0-9+.\-]*://') }
function Norm-Path($s) {
    try { return [IO.Path]::GetFullPath([string]$s).ToLowerInvariant() } catch { return ([string]$s).ToLowerInvariant() }
}
# 열려 있는 프레젠테이션 찾기: FullName 정확히 일치(URL 포함) 우선, 그다음 경로 정규화 비교 (URL 제외)
function Find-Open($app, $path) {
    foreach ($p in $app.Presentations) {
        try { if (([string]$p.FullName) -ieq ([string]$path)) { return $p } } catch {}
    }
    if (-not (Is-Url $path)) {
        $want = Norm-Path $path
        foreach ($p in $app.Presentations) {
            try { if ((-not (Is-Url $p.FullName)) -and ((Norm-Path $p.FullName) -eq $want)) { return $p } } catch {}
        }
    }
    return $null
}
# 프레젠테이션 찾기. 열려 있지 않으면 path로 연다 (visible=$false면 창 없이 읽기 전용).
function Get-Pres($app, $path, $visible) {
    $p = Find-Open $app $path
    if ($p) { return $p }
    if (Is-Url $path) { throw "OneDrive/SharePoint 문서가 PowerPoint에서 열려 있지 않습니다: $path" }
    if (-not (Test-Path -LiteralPath $path)) { throw "파일을 찾을 수 없음: $path" }
    if ($visible) {
        $p = $app.Presentations.Open($path, 0, 0, -1)
    } else {
        $p = $app.Presentations.Open($path, -1, 0, 0)
        $script:opened = $p
    }
    return $p
}
# 슬라이드 ID가 주어졌으면 ID로만 찾는다 (없으면 오류 - 엉뚱한 슬라이드를 건드리지 않도록).
# ID가 없을 때(0/미지정)만 인덱스를 쓴다.
function Get-Slide($p, $a) {
    $sid = 0
    if ($a.slideId) { $sid = [int]$a.slideId }
    if ($sid -gt 0) {
        $sl = $null
        try { $sl = $p.Slides.FindBySlideID($sid) } catch {}
        if (-not $sl) { throw "슬라이드 ID $sid 를 찾을 수 없습니다 (삭제되었거나 다른 파일일 수 있음)." }
        return $sl
    }
    return $p.Slides.Item([int]$a.slide)
}
function Slide-Title($slide) {
    try { if ($slide.Shapes.HasTitle) { $t = $slide.Shapes.Title.TextFrame.TextRange.Text; if ($t) { return $t.Trim() } } } catch {}
    foreach ($s in $slide.Shapes) {
        try {
            if ($s.HasTextFrame -and $s.TextFrame.HasText) {
                $t = $s.TextFrame.TextRange.Text.Trim()
                if ($t) { return $t }
            }
        } catch {}
    }
    return ''
}
function Shape-Info($s) {
    return @{
        name = [string]$s.Name; type = [int]$s.Type
        left = [double]$s.Left; top = [double]$s.Top; width = [double]$s.Width; height = [double]$s.Height
        part = (Get-Tag $s 'SLIDEMAP_PART'); mapId = (Get-Tag $s 'SLIDEMAP_MAP'); qgisId = (Get-Tag $s 'SLIDEMAP_QGIS_ID')
        z = [int]$s.ZOrderPosition
    }
}
function Slide-List($p, $withShapes) {
    $slides = @()
    foreach ($sl in $p.Slides) {
        $e = @{ index = [int]$sl.SlideIndex; id = [int]$sl.SlideID; title = (Slide-Title $sl) }
        if ($withShapes) {
            $sh = @()
            foreach ($s in $sl.Shapes) { $sh += (Shape-Info $s) }
            $e.shapes = $sh
        }
        $slides += $e
    }
    return $slides
}
# export 사본 표식 (Untitled 로 열면 이름이 "프레젠테이션N" 이라 이름으로는 구분할 수 없어 태그를 쓴다)
function Is-ExportCopy($p) {
    try { return (([string]$p.Tags.Item('SLIDEMAP_EXPORT_COPY')) -eq '1') } catch { return $false }
}
# 이전 실행이 중간에 죽어 남은 export 사본(창 없는 임시 프레젠테이션)을 정리
function Close-StaleCopies($app) {
    foreach ($p in @($app.Presentations)) {
        try { if ((Is-ExportCopy $p) -and ($p.Windows.Count -eq 0)) { $p.Saved = -1; $p.Close() } } catch {}
    }
}

try {
    $a = Get-Content -Raw -Encoding UTF8 -LiteralPath $ArgsFile | ConvertFrom-Json
    $app = Get-App
    switch ($a.op) {
    'ping' {
        $result.running = ($app -ne $null)
        if ($app) { $result.version = [string]$app.Version }
    }
    'list' {
        if (-not $app) { throw 'PowerPoint가 실행 중이 아닙니다.' }
        $list = @()
        foreach ($p in $app.Presentations) {
            if (Is-ExportCopy $p) { continue }
            $list += @{ name = [string]$p.Name; fullName = [string]$p.FullName; saved = [bool]$p.Saved
                        slideWidth = [double]$p.PageSetup.SlideWidth; slideHeight = [double]$p.PageSetup.SlideHeight
                        slides = (Slide-List $p $a.withShapes) }
        }
        $result.presentations = $list
    }
    'slides' {   # 파일 경로 하나의 슬라이드 목록 (필요하면 읽기 전용으로 연다)
        if (-not $app) { throw 'PowerPoint가 실행 중이 아닙니다.' }
        $p = Get-Pres $app $a.path $false
        $result.name = [string]$p.Name; $result.fullName = [string]$p.FullName
        $result.slides = (Slide-List $p $a.withShapes)
    }
    'info' {
        if (-not $app) { throw 'PowerPoint가 실행 중이 아닙니다.' }
        $p = Get-Pres $app $a.path $false
        $sl = Get-Slide $p $a
        $shapes = @()
        foreach ($s in $sl.Shapes) { $shapes += (Shape-Info $s) }
        $result.slideWidth = [double]$p.PageSetup.SlideWidth
        $result.slideHeight = [double]$p.PageSetup.SlideHeight
        $result.slideId = [int]$sl.SlideID
        $result.name = [string]$p.Name; $result.fullName = [string]$p.FullName
        $result.title = (Slide-Title $sl)
        $result.shapes = $shapes
    }
    'export' {
        # full(전체) / nomap(지도 객체 숨김) / overlayBlack+overlayWhite(알파 복원용 두 장)
        # 원본은 읽기만 한다: 임시 사본을 만들어 사본에서 작업.
        if (-not $app) { throw 'PowerPoint가 실행 중이 아닙니다.' }
        Close-StaleCopies $app
        $src = Get-Pres $app $a.path $false
        $srcSl = Get-Slide $src $a      # 슬라이드 ID/인덱스 검증 (없으면 여기서 오류)
        $sid = [int]$srcSl.SlideID
        $w = [int]$a.pxWidth; $h = [int]$a.pxHeight
        $tmp = Join-Path ([IO.Path]::GetTempPath()) ($COPY_PREFIX + [guid]::NewGuid().ToString('N') + '.pptx')
        $script:tmpFiles += $tmp
        $src.SaveCopyAs($tmp)
        # ReadOnly=0(메모리 편집 허용), Untitled=-1(원본/임시 파일과 연결 안 함), WithWindow=0
        $script:copy = $app.Presentations.Open($tmp, 0, -1, 0)
        try { $script:copy.Tags.Add('SLIDEMAP_EXPORT_COPY', '1') } catch {}
        $cs = $script:copy.Slides.FindBySlideID($sid)
        if ($a.full) { $cs.Export($a.full, 'PNG', $w, $h) }
        if ($a.nomap) {
            foreach ($s in $cs.Shapes) { if ((Is-SlideMap $s) -and $s.Visible) { $s.Visible = 0 } }
            $cs.Export($a.nomap, 'PNG', $w, $h)
        }
        if ($a.overlayBlack -and $a.overlayWhite) {
            $aboveZ = 0; if ($a.aboveZ) { $aboveZ = [int]$a.aboveZ }
            # 지도 객체 + (지도 프레임보다 뒤에 있는 객체)는 오버레이에서 제외
            foreach ($s in $cs.Shapes) {
                if (((Is-SlideMap $s) -or ([int]$s.ZOrderPosition -le $aboveZ)) -and $s.Visible) { $s.Visible = 0 }
            }
            # 마스터/레이아웃 도형은 지도 뒤에 있으므로 오버레이에서 제외, 배경은 단색 검정 -> 흰색
            $cs.DisplayMasterShapes = 0
            $cs.FollowMasterBackground = 0
            $bg = $cs.Background.Fill
            $bg.Solid(); $bg.Visible = -1; $bg.Transparency = 0
            $bg.ForeColor.RGB = 0
            $cs.Export($a.overlayBlack, 'PNG', $w, $h)
            $bg.ForeColor.RGB = 16777215
            $cs.Export($a.overlayWhite, 'PNG', $w, $h)
        }
    }
    'insert' {
        # 이미지를 프레임 위치에 넣고 태그/이름 부여. 같은 조판의 기존 qgis 파트는 새 그림 삽입이 성공한 뒤에 교체.
        if (-not $app) { throw 'PowerPoint가 실행 중이 아닙니다.' }
        $p = Get-Pres $app $a.path $true
        $sl = Get-Slide $p $a
        $layoutName = [string]$a.layoutName
        $qid = [string]$a.qgisId
        # 교체 대상: 같은 qgis id. id 태그가 없는 구버전 결과는 layout 이름으로 매칭. (삽입 전에 목록 확보)
        $toDel = @()
        foreach ($s in $sl.Shapes) {
            if ((Get-Tag $s 'SLIDEMAP_PART') -ne 'qgis') { continue }
            $sq = Get-Tag $s 'SLIDEMAP_QGIS_ID'
            if ($qid -and $sq) { if ($sq -eq $qid) { $toDel += $s } }
            elseif ((-not $sq) -and ((Get-Tag $s 'SLIDEMAP_QGIS_LAYOUT') -eq $layoutName)) { $toDel += $s }
        }
        if (-not (Test-Path -LiteralPath $a.image)) { throw "삽입할 이미지를 찾을 수 없음: $($a.image)" }
        $pic = $sl.Shapes.AddPicture($a.image, 0, -1, [double]$a.left, [double]$a.top, [double]$a.width, [double]$a.height)
        try {
            $pic.LockAspectRatio = 0
            $pic.Left = [double]$a.left; $pic.Top = [double]$a.top; $pic.Width = [double]$a.width; $pic.Height = [double]$a.height
            $pic.Name = 'SlideMap · QGIS · ' + $layoutName
            $pic.AlternativeText = 'QGIS 조판 지도: ' + $layoutName
            $mapId = [string]$a.mapId
            if ($mapId) { $pic.Tags.Add('SLIDEMAP_MAP', $mapId) }
            $pic.Tags.Add('SLIDEMAP_PART', 'qgis')
            $pic.Tags.Add('SLIDEMAP_VER', '2')
            $pic.Tags.Add('SLIDEMAP_QGIS_LAYOUT', $layoutName)
            if ($qid) { $pic.Tags.Add('SLIDEMAP_QGIS_ID', $qid) }
        } catch {
            try { $pic.Delete() } catch {}
            throw
        }
        # 새 그림이 확정된 뒤에 이전 결과 삭제
        $removed = 0
        foreach ($s in $toDel) { try { $s.Delete(); $removed++ } catch {} }
        # z-order: 같은 mapId의 basemap 바로 위로 (없으면 최상단 유지)
        $base = $null
        foreach ($s in $sl.Shapes) {
            if ((Get-Tag $s 'SLIDEMAP_PART') -eq 'basemap' -and ((-not $mapId) -or (Get-Tag $s 'SLIDEMAP_MAP') -eq $mapId)) { $base = $s; break }
        }
        if ($base) {
            $guard = 0
            while ($pic.ZOrderPosition -gt ($base.ZOrderPosition + 1) -and $guard -lt 500) { $pic.ZOrder(3); $guard++ }
        }
        $result.shapeName = [string]$pic.Name
        $result.removed = $removed
        $result.z = [int]$pic.ZOrderPosition
        $result.saved = $false
        if ($a.save) {
            # 읽기 전용/한 번도 저장 안 한 문서는 건너뛴다 (실패가 아니라 경고)
            if ($p.ReadOnly -ne 0) { $result.saveSkipped = '읽기 전용 프레젠테이션' }
            elseif (-not [string]$p.Path) { $result.saveSkipped = '저장된 적 없는 프레젠테이션 (경로 없음)' }
            else {
                try { $p.Save(); $result.saved = $true }
                catch { $result.saveSkipped = '저장 실패: ' + $_.Exception.Message }
            }
        }
    }
    # ---- 테스트 전용 ----
    'newtest' {   # 새 프레젠테이션 생성. bg: solid(기본)|gradient|picture (picture 는 $a.picture 경로)
        if (-not $app) { throw 'PowerPoint가 실행 중이 아닙니다.' }
        $p = $app.Presentations.Add(-1)
        $sl = $p.Slides.AddSlide(1, $p.SlideMaster.CustomLayouts.Item(7))
        $t = $sl.Shapes.AddTextbox(1, 40, 20, 880, 50)
        $t.TextFrame.TextRange.Text = $a.title
        $t.TextFrame.TextRange.Font.Size = 28
        $t.Name = 'Title Test'
        $card = $sl.Shapes.AddShape(5, 640, 300, 260, 150)
        $card.Name = 'card'
        $card.Fill.ForeColor.RGB = 0x2060E0
        $card.TextFrame.TextRange.Text = 'CARD overlay'
        $base = $sl.Shapes.AddShape(1, 180, 100, 600, 338)
        $base.Name = 'SlideMap basemap'
        $base.Fill.ForeColor.RGB = 0xCCCCCC
        $base.Tags.Add('SLIDEMAP_MAP', 'm-test'); $base.Tags.Add('SLIDEMAP_PART', 'basemap'); $base.Tags.Add('SLIDEMAP_VER', '2')
        $base.ZOrder(1)
        if ($a.bg -eq 'gradient') {
            $sl.FollowMasterBackground = 0
            $f = $sl.Background.Fill
            $f.TwoColorGradient(1, 1)
            $f.ForeColor.RGB = 0x0000FF; $f.BackColor.RGB = 0x00FF00
        } elseif ($a.bg -eq 'picture') {
            $sl.FollowMasterBackground = 0
            $sl.Background.Fill.UserPicture([string]$a.picture)
        }
        if ($a.path) { $p.SaveAs($a.path) }   # path 가 비면 저장 안 된 프레젠테이션 (L3 테스트)
        $result.fullName = [string]$p.FullName
    }
    'leakcopy' {  # 테스트 전용: export 사본을 일부러 열어 둔 채 종료 (비정상 종료 흉내)
        $src = Find-Open $app $a.path
        $tmp = Join-Path ([IO.Path]::GetTempPath()) ($COPY_PREFIX + [guid]::NewGuid().ToString('N') + '.pptx')
        $script:tmpFiles += $tmp
        $src.SaveCopyAs($tmp)
        $c = $app.Presentations.Open($tmp, 0, -1, 0)
        $c.Tags.Add('SLIDEMAP_EXPORT_COPY', '1')
    }
    'touch' {     # 테스트 전용: 프레젠테이션을 '수정됨' 상태로 (Saved=0)
        $p = Find-Open $app $a.path
        if (-not $p) { throw "열려 있지 않음: $($a.path)" }
        $x = $p.Slides.Item(1).Shapes.AddTextbox(1, 1, 1, 20, 20); $x.Name = 'dirty-marker'
        $result.saved = [bool]$p.Saved
    }
    'probe' {     # 테스트 전용: 원본 상태 점검 (배경 종류, 도형 가시성, Saved, 열린 프레젠테이션 이름)
        $p = Find-Open $app $a.path
        if (-not $p) { throw "열려 있지 않음: $($a.path)" }
        $sl = $p.Slides.Item(1)
        $vis = @{}
        foreach ($s in $sl.Shapes) { $vis[[string]$s.Name] = [int]$s.Visible }
        $result.saved = [bool]$p.Saved
        $result.bgType = [int]$sl.Background.Fill.Type
        $result.follow = [int]$sl.FollowMasterBackground
        $result.master = [int]$sl.DisplayMasterShapes
        $result.visible = $vis
        $names = @(); foreach ($q in $app.Presentations) { $names += [string]$q.Name }
        $result.names = $names
        $result.shapeCount = [int]$sl.Shapes.Count
    }
    'closetest' {  # 테스트 전용: 경로가 일치하는 프레젠테이션만 닫기
        $p = Find-Open $app $a.path
        if ($p) { $p.Saved = -1; $p.Close() }
    }
    default { throw "알 수 없는 op: $($a.op)" }
    }
} catch {
    $result = @{ ok = $false; error = [string]$_.Exception.Message }
} finally {
    if ($script:copy) { try { $script:copy.Saved = -1; $script:copy.Close() } catch {} }
    foreach ($f in $script:tmpFiles) { try { Remove-Item -LiteralPath $f -Force -ErrorAction Stop } catch {} }
    if ($script:opened) { try { $script:opened.Close() } catch {} }
}
try {
    $json = $result | ConvertTo-Json -Depth 8 -Compress
    [IO.File]::WriteAllText($OutFile, $json, (New-Object Text.UTF8Encoding($false)))
} catch {
    try { [IO.File]::WriteAllText($OutFile, '{"ok":false,"error":"결과 기록 실패"}', (New-Object Text.UTF8Encoding($false))) } catch {}
}
