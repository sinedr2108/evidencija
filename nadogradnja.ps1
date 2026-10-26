# Nadogradnja aplikacije TiDy Connect (evidencija radnog vremena) - podaci (mapa data) se NIKAD ne diraju.
# Upotreba (PowerShell kao administrator):
#   powershell -ExecutionPolicy Bypass -File C:\evidencija\nadogradnja.ps1 -Zip "C:\Users\Administrator\Downloads\evidencija.zip"
param(
  [Parameter(Mandatory=$true)][string]$Zip,
  [string]$App = "C:\evidencija",
  [string]$Task = "EvidencijaSati",
  [int]$Port = 3000
)
$ErrorActionPreference = "Stop"
if (!(Test-Path $Zip)) { throw "Ne postoji datoteka: $Zip" }
if (!(Test-Path "$App\data\db.json")) { Write-Host "Upozorenje: u $App\data nema db.json (nova instalacija?)." -ForegroundColor Yellow }
$st  = Get-Date -Format "yyyyMMdd-HHmm"
$bk  = "$App-backup\$st"
$tmp = Join-Path $env:TEMP "evidencija-nova-$st"

Write-Host "1/5 Zaustavljam aplikaciju..."
Stop-ScheduledTask -TaskName $Task -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*server.js*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-Sleep -Seconds 2

Write-Host "2/5 Spremam kopiju stare verzije i podataka u $bk (bez fotografija otpremnica, one se ne diraju)"
robocopy $App $bk /E /XD "$App\data\otpremnice" /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Kopija nije uspjela (robocopy $LASTEXITCODE). Ništa nije promijenjeno." }

Write-Host "3/5 Raspakiravam novu verziju..."
Expand-Archive -Path $Zip -DestinationPath $tmp -Force
if (Test-Path "$tmp\evidencija\server.js") { $src = "$tmp\evidencija" }
elseif (Test-Path "$tmp\server.js") { $src = $tmp }
else { throw "U arhivi nema server.js. Ništa nije promijenjeno." }

Write-Host "4/5 Kopiram nove datoteke (mapa data ostaje netaknuta)..."
robocopy $src $App /E /XD "$src\data" /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Kopiranje nije uspjelo (robocopy $LASTEXITCODE). Stara verzija je u $bk" }
Remove-Item $tmp -Recurse -Force

Write-Host "5/5 Pokrećem aplikaciju..."
Start-ScheduledTask -TaskName $Task
Start-Sleep -Seconds 5
try {
  $r = Invoke-WebRequest "http://localhost:$Port/" -UseBasicParsing -TimeoutSec 10
  Write-Host "Gotovo. Aplikacija radi (HTTP $($r.StatusCode)). Kopija prethodne verzije: $bk" -ForegroundColor Green
} catch {
  Write-Host "Aplikacija ne odgovara. Pokrenite ručno:  cd $App ; node server.js  i pogledajte poruku." -ForegroundColor Red
  Write-Host "Stara verzija i podaci su u $bk" -ForegroundColor Red
}
