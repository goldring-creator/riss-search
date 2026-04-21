@echo off
chcp 65001 > /dev/null
setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
set "APP_DIR=%SCRIPT_DIR%_app"
set "CONFIG_DIR=%USERPROFILE%\.riss"
set "PORT_FILE=%CONFIG_DIR%\port"
set "LOG_FILE=%CONFIG_DIR%\server.log"

if not exist "%CONFIG_DIR%" mkdir "%CONFIG_DIR%"
echo %SCRIPT_DIR%> "%CONFIG_DIR%\riss-dir"

where node > /dev/null 2>&1
if errorlevel 1 (
    powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('Node.js가 설치되어 있지 않습니다.`n`nnodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행하세요.', 'RISS 논문 수집기', [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error)"
    exit /b 1
)

if not exist "%APP_DIR%\node_modules" (
    echo 패키지 설치 중... (최초 1회만 실행됩니다)
    cd /d "%APP_DIR%" && npm install --production
    if errorlevel 1 ( echo 패키지 설치 실패. 로그: %LOG_FILE% & pause & exit /b 1 )
)

if not exist "%USERPROFILE%\AppData\Local\ms-playwright" (
    echo 브라우저 설치 중... (최초 1회만 실행됩니다)
    cd /d "%APP_DIR%" && npx playwright install chromium
)

if exist "%PORT_FILE%" (
    set /p EXISTING_PORT=<"%PORT_FILE%"
    curl -sf "http://127.0.0.1:!EXISTING_PORT!/api/config" > /dev/null 2>&1
    if not errorlevel 1 (
        echo 이미 실행 중입니다. 브라우저를 여는 중...
        start "" "http://127.0.0.1:!EXISTING_PORT!"
        exit /b 0
    )
)

if exist "%PORT_FILE%" del "%PORT_FILE%"

cd /d "%APP_DIR%"
echo 서버 시작 중...
start /b node launcher\server.js >> "%LOG_FILE%" 2>&1

set ATTEMPTS=0
:WAIT_LOOP
set /a ATTEMPTS+=1
if %ATTEMPTS% gtr 30 goto TIMEOUT
timeout /t 1 /nobreak > /dev/null
if not exist "%PORT_FILE%" goto WAIT_LOOP
set /p PORT=<"%PORT_FILE%"
curl -sf "http://127.0.0.1:%PORT%/api/config" > /dev/null 2>&1
if errorlevel 1 goto WAIT_LOOP
echo 브라우저를 여는 중... http://127.0.0.1:%PORT%
start "" "http://127.0.0.1:%PORT%"
exit /b 0

:TIMEOUT
echo 서버 시작에 실패했습니다. 로그: %LOG_FILE%
pause
exit /b 1
