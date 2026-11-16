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
