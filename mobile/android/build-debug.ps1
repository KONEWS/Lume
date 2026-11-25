param([string]$Sdk="$env:LOCALAPPDATA\Android\Sdk",[string]$OutputApk)
$ErrorActionPreference='Stop'
Set-Location $PSScriptRoot
$bt=Join-Path $Sdk 'build-tools\36.0.0'
$api=Join-Path $Sdk 'platforms\android-36\android.jar'
$out=Join-Path $PSScriptRoot ('build\sdk-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory "$out\classes","$out\dex" -Force | Out-Null
function run($program,$arguments){ & $program @arguments; if($LASTEXITCODE -ne 0){throw "Build step failed: $program"} }
$ndk=(Get-ChildItem "$Sdk/ndk" -Directory | Sort-Object Name -Descending | Select-Object -First 1).FullName
$cm=(Get-ChildItem "$Sdk/cmake" -Directory | Sort-Object Name -Descending | Select-Object -First 1).FullName
$native=Join-Path $PSScriptRoot 'build/room-arm64'
run "$cm/bin/cmake.exe" @('-S','../native','-B',$native,'-G','Ninja',("-DCMAKE_MAKE_PROGRAM=$cm/bin/ninja.exe"),("-DCMAKE_TOOLCHAIN_FILE=$ndk/build/cmake/android.toolchain.cmake"),'-DANDROID_ABI=arm64-v8a','-DANDROID_PLATFORM=android-28','-DANDROID_STL=c++_static','-DCMAKE_BUILD_TYPE=Release')
run "$cm/bin/cmake.exe" @('--build',$native)
New-Item -ItemType Directory -Force "$out/lib/arm64-v8a" | Out-Null
Copy-Item "$native/liblume.so" "$out/lib/arm64-v8a"
run "$ndk/toolchains/llvm/prebuilt/windows-x86_64/bin/llvm-strip.exe" @('--strip-unneeded',"$out/lib/arm64-v8a/liblume.so")
New-Item -ItemType Directory "$out/generated" -Force | Out-Null
run "$bt\aapt2.exe" @('compile','--dir','app/src/main/res','-o',"$out\resources.zip")
run "$bt\aapt2.exe" @('link','--java',"$out/generated","$out\resources.zip",'-A','app/src/main/assets','-0','mp3','-I',$api,'--manifest','app/src/main/AndroidManifest.xml','-o',"$out\base.apk")
$java=@(Get-ChildItem app/src/main/java -Filter *.java -Recurse | ForEach-Object FullName) + @(Get-ChildItem "$out/generated" -Filter R.java -Recurse | ForEach-Object FullName)
run javac (@('-encoding','UTF-8','-source','8','-target','8','-bootclasspath',("$api;$bt\core-lambda-stubs.jar"),'-d',"$out\classes")+$java)
run jar @('cf',"$out\receiver.jar",'-C',"$out\classes",'.')
run "$bt\d8.bat" @('--min-api','28','--lib',$api,'--output',"$out\dex","$out\receiver.jar")
# jar preserves forward slashes for nested WebView asset paths on Windows.
Copy-Item -LiteralPath '../player-assets' -Destination "$out\assets" -Recurse
run python @('../optimize-player-assets.py',"$out/assets/player",'--report',"$out/asset-optimization.json")
run jar @('uf',"$out\base.apk",'-C',"$out\dex",'classes.dex','-C',$out,'assets','-C',$out,'lib')
run "$bt\zipalign.exe" @('-f','4',"$out\base.apk","$out\aligned.apk")
$keys=Join-Path $env:USERPROFILE '.android'
New-Item -ItemType Directory $keys -Force | Out-Null
$store=Join-Path $keys 'lume-development.jks'
if(!(Test-Path $store)){run keytool @('-genkeypair','-keystore',$store,'-storepass','android','-keypass','android','-alias','lume','-dname','CN=Lume Local Debug','-keyalg','RSA','-validity','3650')}
$release=if($OutputApk){$OutputApk}else{Join-Path $PSScriptRoot '../../release/Lume-Android16-0.5.21-debug.apk'}
run "$bt\apksigner.bat" @('sign','--ks',$store,'--ks-pass','pass:android','--out',$release,"$out\aligned.apk")
run "$bt\apksigner.bat" @('verify','--verbose',$release)

