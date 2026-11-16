# PowerPoint COM 헬퍼: list | export <path> | clear | move-north | resize-basemap
param([string]$Action, [string]$Arg = "")
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$app = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$sl = $app.ActivePresentation.Slides(1)
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
}
