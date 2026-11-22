# Mở HTML do md-sang-word-html.mjs sinh ra bằng Word, hoàn thiện và lưu thành .docx (kèm bản PDF để kiểm tra).
# Việc làm: đặt khổ A4 và lề, chèn trang bìa theo mẫu, dựng mục lục / danh mục hình / danh mục bảng, dựng công thức,
# nhúng ảnh vào file, đầu trang "ĐỒ ÁN TỐT NGHIỆP", đánh số trang (bỏ trang bìa), cập nhật trường.
# File lưu UTF-8 có BOM để Windows PowerShell 5.1 đọc đúng tiếng Việt.
param(
  [Parameter(Mandatory = $true)][string]$Html,
  [Parameter(Mandatory = $true)][string]$Docx,
  [string]$Pdf,
  [string]$TrangBia = (Join-Path $PSScriptRoot 'trang-bia.docx')
)
$ErrorActionPreference = 'Stop'

function Find-Marker($doc, [string]$marker) {
  $r = $doc.Content
  $f = $r.Find
  $f.ClearFormatting()
  $f.Text = $marker
  $f.Forward = $true
  $f.Wrap = 0
  if ($f.Execute()) { return $r }
  return $null
}

# Thay doan chua dau @@...@@ bang mot vung rong (giu dau ngat doan) va tra ve vung do.
function Clear-MarkerParagraph($doc, [string]$marker) {
  $hit = Find-Marker $doc $marker
  if (-not $hit) { throw "Khong tim thay $marker" }
  $p = $hit.Paragraphs.Item(1).Range
  $r = $doc.Range($p.Start, $p.End - 1)
  $r.Text = ''
  return $r
}

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
  $doc = $word.Documents.Open($Html, $false, $false, $false)
  $doc.ActiveWindow.View.Type = 3   # wdPrintView
  try { $doc.SetCompatibilityMode(15) } catch { }

  # Kho A4, le tren 2 cm, duoi 2 cm, trai 3 cm, phai 2 cm.
  foreach ($sec in $doc.Sections) {
    $ps = $sec.PageSetup
    $ps.PageWidth = $word.CentimetersToPoints(21)
    $ps.PageHeight = $word.CentimetersToPoints(29.7)
    $ps.TopMargin = $word.CentimetersToPoints(2)
    $ps.BottomMargin = $word.CentimetersToPoints(2)
    $ps.LeftMargin = $word.CentimetersToPoints(3)
    $ps.RightMargin = $word.CentimetersToPoints(2)
    $ps.HeaderDistance = $word.CentimetersToPoints(0.9)   # chừa khoảng trống giữa đường kẻ đầu trang và nội dung
  }

  # Kiem tra cac style tu HTML da duoc tao dung ten (danh muc hinh/bang dua vao ten style).
  foreach ($name in @('Chu thich hinh', 'Chu thich bang', 'Tieu de trang', 'Tieu de danh muc', 'Van ban', 'Dong ke')) {
    try { $null = $doc.Styles.Item($name) } catch { throw "Thieu style '$name' sau khi mo HTML" }
  }
  $normal = $doc.Styles.Item(-1)   # wdStyleNormal
  $normal.Font.Name = 'Times New Roman'
  $normal.Font.Size = 13

  # Nhung anh vao file thay vi lien ket toi file PNG.
  $linked = 0
  for ($i = $doc.InlineShapes.Count; $i -ge 1; $i--) {
    $s = $doc.InlineShapes.Item($i)
    if ($s.LinkFormat) {
      $s.LinkFormat.SavePictureWithDocument = $true
      $s.LinkFormat.BreakLink()
      $linked++
    }
  }
  Write-Output "anh da nhung: $linked / $($doc.InlineShapes.Count)"

  # Trang bìa theo mẫu (khung hoa văn, logo, bảng thông tin) từ trang-bia.docx (tạo bằng tao-trang-bia.ps1).
  $r = Clear-MarkerParagraph $doc '@@BIA@@'
  $start = $r.Start
  $before = $doc.Content.End
  $r.InsertFile($TrangBia)
  $bia = $doc.Range($start, $start + ($doc.Content.End - $before))
  $bia.ParagraphFormat.SpaceBefore = 0
  $bia.ParagraphFormat.SpaceAfter = 0
  # Đoạn cuối ("Hà Nội - năm") nhận định dạng của đoạn đánh dấu: căn giữa lại cho giống mẫu.
  $bia.Paragraphs.Item($bia.Paragraphs.Count).Alignment = 1
  Write-Output "trang bia: $($bia.Paragraphs.Count) doan, $($doc.Shapes.Count) khung"

  # Cong thuc: van ban UnicodeMath -> phuong trinh Word.
  $eq = 0
  while ($true) {
    $hit = Find-Marker $doc '@@EQ@@'
    if (-not $hit) { break }
    $p = $hit.Paragraphs.Item(1).Range
    $r = $doc.Range($p.Start, $p.End - 1)
    $linear = $r.Text.Substring(6)
    $r.Text = $linear
    $null = $doc.OMaths.Add($r)
    $r.OMaths.Item(1).BuildUp()
    $eq++
  }
  Write-Output "cong thuc: $eq"

  # Muc luc: Heading 1-3 cung cac trang "DANH MUC ..." (theo mau); danh muc hinh/bang theo style chu thich.
  $r = Clear-MarkerParagraph $doc '@@TOC@@'
  $null = $doc.Fields.Add($r, -1, 'TOC \o "1-3" \h \z \t "Tieu de danh muc,1"', $false)
  $r = Clear-MarkerParagraph $doc '@@TOF_HINH@@'
  $null = $doc.Fields.Add($r, -1, 'TOC \h \z \t "Chu thich hinh,1"', $false)
  $r = Clear-MarkerParagraph $doc '@@TOF_BANG@@'
  $null = $doc.Fields.Add($r, -1, 'TOC \h \z \t "Chu thich bang,1"', $false)
  foreach ($lv in -20, -21, -22) {   # wdStyleTOC1..3
    $st = $doc.Styles.Item($lv)
    $st.Font.Name = 'Times New Roman'; $st.Font.Size = 13; $st.Font.Bold = $false
    $st.ParagraphFormat.SpaceBefore = 0; $st.ParagraphFormat.SpaceAfter = 0
    $st.ParagraphFormat.LineSpacingRule = 1   # 1,5 dong
  }

  # Số trang ở giữa chân trang, số Ả Rập liên tục theo mẫu: trang bìa không in số (tính là 0), lời cảm ơn là trang 1.
  $sec = $doc.Sections.Item(1)
  $sec.PageSetup.DifferentFirstPageHeaderFooter = -1
  $footer = $sec.Footers.Item(1)
  $null = $footer.PageNumbers.Add(1, $false)
  $footer.PageNumbers.NumberStyle = 0   # wdPageNumberStyleArabic
  $footer.PageNumbers.RestartNumberingAtSection = $true
  $footer.PageNumbers.StartingNumber = 0
  $footer.Range.Font.Name = 'Times New Roman'
  $footer.Range.Font.Size = 13

  # Đầu trang theo mẫu: "ĐỒ ÁN TỐT NGHIỆP" căn trái, kẻ một đường dưới; trang bìa không có.
  $h = $sec.Headers.Item(1).Range
  $h.Text = 'ĐỒ ÁN TỐT NGHIỆP'
  $h.Font.Name = 'Times New Roman'; $h.Font.Size = 13; $h.Font.Bold = $false
  $h.ParagraphFormat.Alignment = 0
  $h.ParagraphFormat.SpaceBefore = 0; $h.ParagraphFormat.SpaceAfter = 0
  $h.ParagraphFormat.LineSpacingRule = 0   # đơn
  $line = $h.ParagraphFormat.Borders.Item(-3)   # wdBorderBottom
  $line.LineStyle = 1; $line.LineWidth = 12; $line.Color = 0   # nét liền 1,5 pt, màu đen

  $doc.Repaginate()
  $null = $doc.Fields.Update()
  foreach ($t in $doc.TablesOfContents) { $t.Update() }
  $doc.Repaginate()
  $null = $doc.Fields.Update()

  $doc.SaveAs2($Docx, 16)   # wdFormatDocumentDefault (.docx)
  Write-Output "so trang: $($doc.ComputeStatistics(2))"
  if ($Pdf) { $doc.ExportAsFixedFormat($Pdf, 17) }   # wdExportFormatPDF
  $doc.Close($false)
  Write-Output "da luu: $Docx"
}
finally {
  $word.Quit()
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($word)
}
