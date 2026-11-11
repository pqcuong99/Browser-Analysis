# Cài SentinelFP ground listener (STUN/TURN đối chiếu, rule WRTC_09) trên Windows Server 2012 R2 trở lên.
# Chạy bằng PowerShell quyền Administrator, trong thư mục chứa file này và stun-listener.cjs:
#
#   powershell -ExecutionPolicy Bypass -File .\install.ps1 -Key "<GROUND_KEY>"
#   powershell -ExecutionPolicy Bypass -File .\install.ps1 -Key "<GROUND_KEY>" -ApiAllowFrom 123.17.23.145
#   powershell -ExecutionPolicy Bypass -File .\install.ps1 -Update      (thay bản listener mới, giữ cấu hình)
#   powershell -ExecutionPolicy Bypass -File .\install.ps1 -Uninstall
#
# Không đụng tới IIS / web đang chạy: tiến trình riêng, cổng riêng (UDP+TCP 3478, TCP 8478), thư mục riêng.
param(
  [string]$Key,
  [int]$StunPort = 3478,
  [int]$ApiPort = 8478,
  [string]$Dir = 'C:\sentinelfp-ground',
  # IP được phép gọi API tra cứu (IP nhà bạn). Bỏ trống = mọi IP, vẫn cần khóa.
  [string[]]$ApiAllowFrom = @(),
  [switch]$Uninstall,
  # Chỉ thay stun-listener.cjs bằng bản mới rồi chạy lại; giữ nguyên khóa, cổng, firewall rule
  [switch]$Update
)
$ErrorActionPreference = 'Stop'
$TaskName = 'SentinelFP Ground Listener'
$RulePrefix = 'SentinelFP Ground'

function Stop-Listener {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like '*stun-listener.cjs*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" |
    Where-Object { $_.CommandLine -like '*sentinelfp-ground*run.cmd*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
}

function Test-Health([int]$Port) {
  Start-Sleep -Seconds 3
  try {
    $h = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 5
    Write-Host "OK: listener dang chay (sessions=$($h.sessions)). Log: $Dir\listener.log"
  } catch {
    Write-Warning "Listener chua phan hoi. Xem $Dir\listener.log"
    exit 2
  }
}

if ($Update) {
  if (-not (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)) { throw 'Chua cai listener. Chay install.ps1 -Key "<KHOA>" truoc.' }
  $src = Join-Path $PSScriptRoot 'stun-listener.cjs'
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Stop-Listener
  Copy-Item $src $Dir -Force
  Start-ScheduledTask -TaskName $TaskName
  # Đọc cổng API đang dùng từ run.cmd
  $m = Select-String -Path "$Dir\run.cmd" -Pattern '^set API_PORT=(\d+)' | Select-Object -First 1
  Test-Health ($(if ($m) { [int]$m.Matches[0].Groups[1].Value } else { $ApiPort }))
  return
}

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}
Stop-Listener
Get-NetFirewallRule -DisplayName "$RulePrefix*" -ErrorAction SilentlyContinue | Remove-NetFirewallRule

if ($Uninstall) {
  if (Test-Path $Dir) { Remove-Item -Recurse -Force $Dir }
  Write-Host 'Da go listener, scheduled task va firewall rule.'
  return
}

if (-not $Key -or $Key.Length -lt 16) { throw 'Can -Key "<chuoi bi mat >= 16 ky tu>" (giong GROUND_KEY o may chay SentinelFP)' }
if ($Key -match '[\s"%^&|<>]') { throw 'Key chi nen gom chu, so, - va _ (dung lenh tao key trong README)' }
$node = (Get-Command node -ErrorAction Stop).Definition
$src = Join-Path $PSScriptRoot 'stun-listener.cjs'
if (-not (Test-Path $src)) { throw "Khong thay $src" }

# Kiểm tra cổng còn trống
$busyUdp = Get-NetUDPEndpoint -LocalPort $StunPort -ErrorAction SilentlyContinue
$busyTcp = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in $StunPort, $ApiPort }
if ($busyUdp -or $busyTcp) { throw "Cong $StunPort/$ApiPort dang bi chiem, chon cong khac bang -StunPort / -ApiPort" }

New-Item -ItemType Directory -Force $Dir | Out-Null
Copy-Item $src $Dir -Force
$run = @"
@echo off
set GROUND_KEY=$Key
set STUN_PORT=$StunPort
set API_PORT=$ApiPort
:loop
"$node" "$Dir\stun-listener.cjs" >> "$Dir\listener.log" 2>&1
ping -n 6 127.0.0.1 >nul
goto loop
"@
Set-Content -Path "$Dir\run.cmd" -Value $run -Encoding ASCII

# Khóa nằm trong run.cmd: chỉ Administrators, SYSTEM và LOCAL SERVICE (tài khoản chạy listener) đọc được
& icacls $Dir /inheritance:r /grant:r 'Administrators:(OI)(CI)F' 'SYSTEM:(OI)(CI)F' 'NT AUTHORITY\LOCAL SERVICE:(OI)(CI)M' | Out-Null

# Scheduled task chạy lúc khởi động, quyền thấp (LOCAL SERVICE), không giới hạn thời gian
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$Dir\run.cmd`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\LOCAL SERVICE' -LogonType ServiceAccount
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal | Out-Null

# Firewall: chỉ đúng các cổng cần
New-NetFirewallRule -DisplayName "$RulePrefix STUN UDP $StunPort" -Direction Inbound -Protocol UDP -LocalPort $StunPort -Action Allow -Profile Any | Out-Null
New-NetFirewallRule -DisplayName "$RulePrefix STUN TCP $StunPort" -Direction Inbound -Protocol TCP -LocalPort $StunPort -Action Allow -Profile Any | Out-Null
$api = @{ DisplayName = "$RulePrefix API TCP $ApiPort"; Direction = 'Inbound'; Protocol = 'TCP'; LocalPort = $ApiPort; Action = 'Allow'; Profile = 'Any' }
if ($ApiAllowFrom.Count) { $api.RemoteAddress = $ApiAllowFrom }
New-NetFirewallRule @api | Out-Null

Start-ScheduledTask -TaskName $TaskName
Write-Host "Nho mo UDP $StunPort, TCP $StunPort, TCP $ApiPort trong firewall cua nha cung cap VPS (neu co)."
Test-Health $ApiPort
