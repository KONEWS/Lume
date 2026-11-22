param([string]$Studio='D:\DevEco Studio',[string]$OutputHap)
$ErrorActionPreference='Stop'
Set-Location $PSScriptRoot
if(!(Test-Path 'build-profile.json5')){
    Copy-Item 'build-profile.example.json5' 'build-profile.json5'
}
$env:DEVECO_SDK_HOME=Join-Path $Studio sdk
$env:NODE_HOME=Join-Path $Studio tools/node
$env:JAVA_HOME=Join-Path $Studio jbr
& (Join-Path $Studio 'tools/hvigor/bin/hvigorw.bat') assembleHap --no-daemon
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
if($OutputHap){Copy-Item 'entry/build/default/outputs/default/entry-default-signed.hap' $OutputHap -Force}
exit $LASTEXITCODE
