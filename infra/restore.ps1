param([Parameter(Mandatory=$true)][string]$DatabaseUrl,[Parameter(Mandatory=$true)][string]$BackupPath,[Parameter(Mandatory=$true)][string]$SourceDatabase,[switch]$ConfirmIsolatedTarget)
$ErrorActionPreference='Stop'
if(!$ConfirmIsolatedTarget){throw 'Restore requires an explicitly confirmed isolated target database'}
if(!(Test-Path -LiteralPath $BackupPath -PathType Leaf)){throw 'Backup file not found'}
if ($SourceDatabase -notmatch '^[\w-]+$' -or
    $DatabaseUrl -notmatch '^(mongodb(?:\+srv)?://[^/]+)/([\w-]+)(\?.*)?$') {
  throw 'Specify the source database and a MongoDB URL naming the isolated target'
}
$TargetDatabase = $Matches[2]
$ServerUrl = $Matches[1] + '/' + $Matches[3]
if ($TargetDatabase -eq $SourceDatabase) { throw 'Use a different name for the isolated target database' }
& mongorestore "--uri=$ServerUrl" "--archive=$BackupPath" --gzip --stopOnError `
  "--nsInclude=$SourceDatabase.*" "--nsFrom=$SourceDatabase.*" "--nsTo=$TargetDatabase.*"
if($LASTEXITCODE -ne 0){throw 'Restore failed; inspect the isolated target before retrying'}
