param(
  [ValidateSet("duel","coop","both")]
  [string]$Mode = "both"
)

$ErrorActionPreference = "Stop"
$server = Start-Process -FilePath node -ArgumentList 'node_modules/http-server/bin/http-server','-p','5173','-c-1' -WorkingDirectory $PSScriptRoot\.. -PassThru
Start-Sleep -Milliseconds 1000

try {
  if ($Mode -eq "duel" -or $Mode -eq "both") {
    node "$PSScriptRoot/web_game_playwright_client.js" --url http://127.0.0.1:5173 --actions-file "$PSScriptRoot/../tests/actions_duel.json" --click-selector "#start-duel-btn" --iterations 3 --pause-ms 200 --screenshot-dir "$PSScriptRoot/../output/web-game/duel"
  }

  if ($Mode -eq "coop" -or $Mode -eq "both") {
    node "$PSScriptRoot/web_game_playwright_client.js" --url http://127.0.0.1:5173 --actions-file "$PSScriptRoot/../tests/actions_coop.json" --click-selector "#start-coop-btn" --iterations 3 --pause-ms 200 --screenshot-dir "$PSScriptRoot/../output/web-game/coop"
  }
}
finally {
  if ($server) { Stop-Process -Id $server.Id -Force }
}
