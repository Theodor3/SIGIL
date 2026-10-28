param([string]$Repo = "$PSScriptRoot/../..")
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive=Join-Path $Repo '.swarm/reports/market-data/csx-2026-10-21.xlsx'
$receipt=Get-Content -Raw (Join-Path $Repo '.swarm/reports/market-data/csx-receipt-2026-10-27.json') | ConvertFrom-Json
if((Get-FileHash -Algorithm SHA256 $archive).Hash.ToLowerInvariant() -ne $receipt.sha256){throw 'Workbook receipt mismatch'}
$z=[System.IO.Compression.ZipFile]::OpenRead($archive)
function Read-ZipXml($name){$reader=[System.IO.StreamReader]::new($z.GetEntry($name).Open());try{[xml]$reader.ReadToEnd()}finally{$reader.Dispose()}}
try{
 $shared=Read-ZipXml 'xl/sharedStrings.xml'
 $strings=@($shared.sst.si | ForEach-Object {$_.InnerText})
 $sheet=Read-ZipXml 'xl/worksheets/sheet1.xml'
 $cells=@{}
 foreach($cell in $sheet.worksheet.sheetData.row.c){$value=[string]$cell.v;if($cell.t -eq 's'){$value=$strings[[int]$value]};$cells[[string]$cell.r]=$value}
 $terminals=@(17..26 | ForEach-Object { [ordered]@{name=$cells["A$_"];dwellHours=[double]::Parse($cells["B$_"],[cultureinfo]::InvariantCulture);cell="B$_"} })
 $data=[ordered]@{schemaVersion=1;operator='CSX';sourceUrl=$receipt.sourceUrl;sha256=$receipt.sha256;retrievedAt=$receipt.retrievedAt;publicationTimestamp=$null;
  periodStart=[DateTime]::FromOADate([double]$cells['E3']).ToString('yyyy-MM-dd');periodEnd=[DateTime]::FromOADate([double]$cells['E4']).ToString('yyyy-MM-dd');
  sheet='Rail Service (Item Nos. 1-6)';systemSpeedMph=[double]::Parse($cells['B13'],[cultureinfo]::InvariantCulture);systemDwellHours=[double]::Parse($cells['B27'],[cultureinfo]::InvariantCulture);terminals=$terminals;trendObservations=1;predictiveResultsAvailable=$false}
 $target=Join-Path $Repo 'web/public/research/freight-evidence.json'
 [IO.File]::WriteAllText($target,($data | ConvertTo-Json -Depth 6)+"`n",[Text.UTF8Encoding]::new($false))
 [pscustomobject]$data | Select-Object periodStart,periodEnd,systemSpeedMph,systemDwellHours,trendObservations | ConvertTo-Json
}finally{$z.Dispose()}

