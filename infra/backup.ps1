param([Parameter(Mandatory=$true)][string]$DatabaseUrl,[Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference='Stop'
if(Test-Path -LiteralPath $OutputPath){throw 'Refusing to overwrite an existing backup'}
& pg_dump --dbname=$DatabaseUrl --format=custom --file=$OutputPath
if($LASTEXITCODE -ne 0){throw 'Backup failed'}
Get-FileHash -Algorithm SHA256 -LiteralPath $OutputPath
