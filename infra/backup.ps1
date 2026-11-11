param([Parameter(Mandatory=$true)][string]$DatabaseUrl,[Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference='Stop'
if(Test-Path -LiteralPath $OutputPath){throw 'Refusing to overwrite an existing backup'}
if ($DatabaseUrl -notmatch '^mongodb(?:\+srv)?://[^/]+/[^/?]+(?:\?|$)') {
  throw 'The MongoDB connection URL must name the database to back up'
}
& mongodump "--uri=$DatabaseUrl" "--archive=$OutputPath" --gzip
if($LASTEXITCODE -ne 0){throw 'Backup failed'}
Get-FileHash -Algorithm SHA256 -LiteralPath $OutputPath
