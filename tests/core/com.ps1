# PowerPoint COM helper
# usage: com.ps1 <action> [arg] [slideIndex(default 1)]
#  list | export <path> | clear | move-north | resize-basemap | move-frame | add-slide | goto <n> | add-textbox | trim-slides | current | count
param([string]$Action, [string]$Arg = "", [int]$Idx = 1)
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$app = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$pres = $app.ActivePresentation
$sl = $pres.Slides($Idx)
function Part($sh) { try { $t = $sh.Tags.Item("SLIDEMAP_PART"); return $t } catch { return "" } }
switch ($Action) {
  "list" {
    foreach ($sh in $sl.Shapes) {
      "{0}|{1}|{2}|{3}|{4}|{5}|{6}|rot={7}" -f $sh.Name, (Part $sh), [math]::Round($sh.Left,1), [math]::Round($sh.Top,1), [math]::Round($sh.Width,1), [math]::Round($sh.Height,1), $sh.Type, $sh.Rotation
    }
  }
  "export" { $sl.Export($Arg, "PNG", 1280, 720); "exported $Arg" }
  "children" {
    # 그룹(part=Arg)의 자식 덤프: 이름|종류|좌표|여백|글꼴|크기|외곽선
    foreach ($sh in $sl.Shapes) { if ((Part $sh) -eq $Arg -and $sh.Type -eq 6) {
      foreach ($c in $sh.GroupItems) {
        $tf = ""; if ($c.HasTextFrame -ne 0) { $t = $c.TextFrame; $tf = "text='{0}' margins={1}/{2}/{3}/{4} font={5} size={6} bold={7} align={8} vanchor={9} autosize={10} wrap={11}" -f $t.TextRange.Text, $t.MarginLeft, $t.MarginRight, $t.MarginTop, $t.MarginBottom, $t.TextRange.Font.Name, $t.TextRange.Font.Size, $t.TextRange.Font.Bold, $t.TextRange.ParagraphFormat.Alignment, $t.VerticalAnchor, $t.AutoSize, $t.WordWrap }
        "{0}|type={1}|{2},{3},{4},{5}|part={6}|line={7} fill={8}|{9}" -f $c.Name, $c.Type, [math]::Round($c.Left,2), [math]::Round($c.Top,2), [math]::Round($c.Width,2), [math]::Round($c.Height,2), (Part $c), $c.Line.Visible, $c.Fill.Visible, $tf
      } } }
  }
  "move-part" { foreach ($sh in $sl.Shapes) { if ((Part $sh) -eq $Arg) { $sh.Left = $sh.Left - 120; $sh.Top = $sh.Top - 40; "moved $Arg to $($sh.Left),$($sh.Top)" } } }
  "ungroup" { foreach ($sh in @($sl.Shapes)) { if ((Part $sh) -eq $Arg -and $sh.Type -eq 6) { $r = $sh.Ungroup(); "ungrouped $Arg -> $($r.Count) shapes" } } }
  "clear" { for ($i = $sl.Shapes.Count; $i -ge 1; $i--) { $sl.Shapes($i).Delete() }; "cleared" }
  "move-north" { foreach ($sh in $sl.Shapes) { if ((Part $sh) -eq "north") { $sh.Left = $sh.Left - 150; $sh.Top = $sh.Top + 100; "moved north to $($sh.Left),$($sh.Top)" } } }
  "resize-basemap" { foreach ($sh in $sl.Shapes) { if ((Part $sh) -eq "basemap") { $sh.LockAspectRatio = 0; $sh.Left = 100; $sh.Top = 40; $sh.Width = 760; $sh.Height = 440; "resized basemap" } } }
  "move-frame" { foreach ($sh in $sl.Shapes) { if ((Part $sh) -eq "basemap") { $sh.LockAspectRatio = 0; $sh.Left = 200; $sh.Top = 90; $sh.Width = 640; $sh.Height = 360; "moved frame" } } }
  "add-slide" { $null = $pres.Slides.AddSlide($pres.Slides.Count + 1, $pres.Slides(1).CustomLayout); "slides=$($pres.Slides.Count)" }
  "goto" { $app.ActiveWindow.View.GotoSlide([int]$Arg); "now=$($app.ActiveWindow.View.Slide.SlideIndex)" }
  "current" { "$($app.ActiveWindow.View.Slide.SlideIndex)" }
  "count" { "$($pres.Slides.Count)" }
  "trim-slides" { for ($i = $pres.Slides.Count; $i -ge 2; $i--) { $pres.Slides($i).Delete() }; $app.ActiveWindow.View.GotoSlide(1); "trimmed" }
  "add-textbox" {
    $tb = $sl.Shapes.AddTextbox(1, 300, 200, 300, 60)
    $tb.Name = "USER_TITLE"
    $tb.TextFrame.TextRange.Text = "USER TITLE on top"
    "added textbox z=$($tb.ZOrderPosition)"
  }
}
