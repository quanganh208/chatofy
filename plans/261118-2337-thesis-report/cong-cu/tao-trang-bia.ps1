# Tạo cong-cu/trang-bia.docx từ trang bìa của mẫu "BC - ĐATN - FINGENIUS" (khung hoa văn, logo PTIT, bảng thông tin),
# rồi thay nội dung bằng thông tin đề tài của nhóm. Chạy một lần; word-hoan-thien-docx.ps1 chèn file này làm trang bìa.
# File lưu UTF-8 có BOM để Windows PowerShell 5.1 đọc đúng tiếng Việt.
param(
  [Parameter(Mandatory = $true)][string]$Mau,
  [Parameter(Mandatory = $true)][string]$Dich
)
$ErrorActionPreference = 'Stop'

# Tìm đoạn chứa chuỗi neo (chỉ dùng phần ASCII của mẫu cho chắc), trả về vùng nội dung không gồm dấu ngắt đoạn.
function Get-ParagraphBody($doc, [string]$anchor) {
  $r = $doc.Content
  $f = $r.Find
  $f.ClearFormatting(); $f.Text = $anchor; $f.Forward = $true; $f.Wrap = 0
  if (-not $f.Execute()) { throw "Không tìm thấy '$anchor' trong trang bìa mẫu" }
  $p = $r.Paragraphs.Item(1).Range
  return $doc.Range($p.Start, $p.End - 1)
}

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
  $doc = $word.Documents.Open($Mau, $false, $true)
  $doc.SaveAs2($Dich, 16)

  # Bỏ mọi thứ sau dòng "Hà Nội - 2025" (hết trang bìa).
  $cuoi = Get-ParagraphBody $doc '- 2025'
  $doc.Range($cuoi.End, $doc.Content.End).Delete() | Out-Null

  # Nội dung đề tài của nhóm.
  (Get-ParagraphBody $doc 'FLUTTER').Text = 'THỜI GIAN THỰC CHATOFY'
  $dongTren = (Get-ParagraphBody $doc 'THỜI GIAN THỰC CHATOFY').Paragraphs.Item(1).Previous(1).Range
  $doc.Range($dongTren.Start, $dongTren.End - 1).Text = 'NGHIÊN CỨU VÀ PHÁT TRIỂN HỆ THỐNG DỊCH THOẠI'
  (Get-ParagraphBody $doc ': TS.').Text = ': PGS. TS. Nguyễn Trọng Khánh'
  (Get-ParagraphBody $doc 'B21DCCN716').Text = 'Nguyễn Việt Tú - B22DCCN748 - D22CNPM02'
  (Get-ParagraphBody $doc 'B21DCCN080').Text = 'Nguyễn Mạc Quang Anh - B22DCCN029 - D22CNPM02'
  (Get-ParagraphBody $doc 'B21DCCN715').Rows.Item(1).Delete()
  (Get-ParagraphBody $doc '2021 - 2026').Text = ': 2022 - 2027'
  (Get-ParagraphBody $doc '- 2025').Text = 'Hà Nội - 2026'

  # Bảng thông tin: nới cột nội dung để tên GVHD và tên thành viên không xuống dòng.
  $t = $doc.Tables.Item(1)
  foreach ($c in $t.Range.Cells) {
    if ($c.Width -ge 300) { $c.Width = 415.5; $c.Range.ParagraphFormat.Alignment = 0 }   # dòng thành viên (gộp ô)
    elseif ($c.ColumnIndex -eq 2 -and $c.Width -lt 150) { $c.Width = 195 }                 # ô ":" của dòng thành viên
    elseif ($c.ColumnIndex -eq 2) { $c.Width = 240 }
  }
  Write-Output "bảng: căn=$($t.Rows.Alignment) thụt=$($t.Rows.LeftIndent)"

  # Khung hoa văn: đổi sang định vị theo trang để không lệch khi lề của báo cáo khác lề của mẫu.
  $ps = $doc.Sections.Item(1).PageSetup
  foreach ($sh in $doc.Shapes) {
    if ($sh.RelativeVerticalPosition -ne 1) { $top = $sh.Top + $ps.TopMargin; $sh.RelativeVerticalPosition = 1; $sh.Top = $top }
    if ($sh.RelativeHorizontalPosition -ne 1) { $left = $sh.Left + $ps.LeftMargin; $sh.RelativeHorizontalPosition = 1; $sh.Left = $left }
    Write-Output ("khung: left={0} top={1} w={2} h={3}" -f $sh.Left, $sh.Top, $sh.Width, $sh.Height)
  }

  $doc.Save()
  $doc.Close($false)
  Write-Output "đã tạo: $Dich"
}
finally {
  $word.Quit()
}
