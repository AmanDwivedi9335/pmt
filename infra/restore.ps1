param([Parameter(Mandatory=$true)][string]$DatabaseUrl,[Parameter(Mandatory=$true)][string]$BackupPath,[switch]$ConfirmIsolatedTarget)
$ErrorActionPreference='Stop'
if(!$ConfirmIsolatedTarget){throw 'Restore requires an explicitly confirmed isolated target database'}
if(!(Test-Path -LiteralPath $BackupPath -PathType Leaf)){throw 'Backup file not found'}
& pg_restore --dbname=$DatabaseUrl --no-owner --exit-on-error $BackupPath
if($LASTEXITCODE -ne 0){throw 'Restore failed; inspect the isolated target before retrying'}
