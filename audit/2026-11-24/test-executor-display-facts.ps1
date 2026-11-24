$ErrorActionPreference = 'Stop'
$audit = (Get-Item (Join-Path $PSScriptRoot '..')).FullName
$base = (Get-Item (Join-Path $audit '../large-delivery-20261124/executor')).FullName
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('rexbid-color-executor-' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($testRoot) | Out-Null
foreach ($folder in 'providers','sync','scripts','public','docs/proposals','tests') {
  $dest = [IO.Directory]::CreateDirectory((Join-Path $testRoot $folder)).FullName
  Get-ChildItem -LiteralPath (Join-Path $base $folder) -File | Where-Object {
    $_.Extension -in '.js','.cjs','.mjs','.json','.html','.sql'
  } | Copy-Item -Destination $dest
}
Copy-Item -LiteralPath (Join-Path $base 'tests/fixtures') -Destination (Join-Path $testRoot 'tests/fixtures') -Recurse
foreach ($item in 'providers/apibara.js','providers/contract.js','sync/d1-repository.js','sync/d1-read-repository.js','sync/feed-history-enrichment.cjs','sync/feed-record-hydration.cjs','sync/feed-change-rollback.cjs','sync/publication-refresh.cjs','sync/listing-display-facts.cjs','docs/proposals/0019_catalog_exterior_color.sql','tests/feed-change-rollback.test.cjs','tests/feed-record-hydration.test.cjs','tests/listing-display-facts.test.cjs') {
  Copy-Item -LiteralPath (Join-Path $audit ('executor/' + $item)) -Destination (Join-Path $testRoot $item)
}
Copy-Item -LiteralPath (Join-Path $audit 'site/public/car.html') -Destination (Join-Path $testRoot 'public/car.html')
Push-Location $testRoot
try {
  node --test tests/listing-display-facts.test.cjs tests/feed-record-hydration.test.cjs tests/feed-change-rollback.test.cjs | Tee-Object -FilePath (Join-Path $PSScriptRoot 'executor-display-facts.tap')
  $result = $LASTEXITCODE
} finally {
  Pop-Location
}
exit $result
