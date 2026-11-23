# 用 Microsoft Word 把 DOCX 导出为 PDF。
# 为什么单独一个脚本：Word 只能通过 COM 调用，Node 里没有 COM 桥，所以交给 PowerShell。
#
# 参数：
#   -Input  源 DOCX
#   -Output 目标 PDF
# 退出码：0 成功；2 Word 未安装；3 打开失败；4 导出失败；5 超时
param(
  [Parameter(Mandatory=$true)][string]$Input,
  [Parameter(Mandatory=$true)][string]$Output
)

$ErrorActionPreference = 'Stop'

try {
  $word = New-Object -ComObject Word.Application
} catch {
  Write-Output "WORD_UNAVAILABLE: $($_.Exception.Message)"
  exit 2
}

$word.Visible = $false
try { $word.DisplayAlerts = 0 } catch {}

$doc = $null
try {
  # 只读打开，不进最近文件列表，避免弹窗与锁文件
  $doc = $word.Documents.Open($Input, $false, $true, $false, '', '', $false, '', '', 0, 0, $false, $false, $false, $false)
} catch {
  Write-Output "WORD_OPEN_FAILED: $($_.Exception.Message)"
  try { $word.Quit() } catch {}
  exit 3
}

try {
  # wdExportFormatPDF = 17
  # Item 0 = wdExportDocumentContent；CreateBookmarks 0 = 无书签
  $doc.ExportAsFixedFormat($Output, 17, $false, 0, 0, 0, 0, 0, $true, $true, 0, $true, $true, $false)
} catch {
  Write-Output "WORD_EXPORT_FAILED: $($_.Exception.Message)"
  try { $doc.Close($false) } catch {}
  try { $word.Quit() } catch {}
  exit 4
}

try { $doc.Close($false) } catch {}
try { $word.Quit() } catch {}
Start-Sleep -Milliseconds 300
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null

if (Test-Path $Output) {
  Write-Output "WORD_OK: $Output"
  exit 0
} else {
  Write-Output "WORD_NO_OUTPUT"
  exit 4
}
