$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$elasticHome = Join-Path $projectRoot '.local\elasticsearch-8.19.17'
$elasticExecutable = Join-Path $elasticHome 'bin\elasticsearch.bat'
$elasticTemp = Join-Path $projectRoot '.local\elasticsearch-tmp'

if (-not (Test-Path -LiteralPath $elasticExecutable)) {
  throw "Elasticsearch is not installed at $elasticHome"
}

try {
  Invoke-RestMethod 'http://127.0.0.1:9200' -TimeoutSec 2 | Out-Null
  Write-Output 'Elasticsearch is already running on http://127.0.0.1:9200'
  exit 0
} catch {}

New-Item -ItemType Directory -Force -Path $elasticTemp | Out-Null
$env:ES_TMPDIR = $elasticTemp
Start-Process -FilePath $elasticExecutable -WorkingDirectory $elasticHome -RedirectStandardOutput (Join-Path $projectRoot '.local\elasticsearch.out.log') -RedirectStandardError (Join-Path $projectRoot '.local\elasticsearch.err.log') -WindowStyle Hidden
Write-Output 'Elasticsearch is starting on http://127.0.0.1:9200'
