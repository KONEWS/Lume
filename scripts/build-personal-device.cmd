@echo off
setlocal
cd /d "%~dp0.."
for /f "usebackq delims=" %%V in (`"%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "LUME_VS=%%V"
call "%LUME_VS%\VC\Auxiliary\Build\vcvars64.bat" >nul || exit /b 1
set "OUT=%TEMP%\lume-personal-%RANDOM%%RANDOM%"
mkdir "%OUT%" || exit /b 1
set "ROOT=%CD%"
pushd "%OUT%"
cl /nologo /O2 /EHsc /MT /utf-8 /std:c++17 /DNOMINMAX /DUTF8PROC_STATIC "%ROOT%\mobile\native\peer_stdio.cpp" "%ROOT%\mobile\native\peer_exchange.cpp" "%ROOT%\mobile\native\vendor\monocypher.c" "%ROOT%\mobile\native\vendor\utf8proc\utf8proc.c" /Fe:device-host.exe /link ws2_32.lib iphlpapi.lib bcrypt.lib
if errorlevel 1 (popd & exit /b 1)
python "%ROOT%\scripts\stage-personal-device.py" device-host.exe
set "RESULT=%ERRORLEVEL%"
popd
exit /b %RESULT%
