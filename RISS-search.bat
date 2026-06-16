@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

:: ── 기본 경로 설정 (하드코딩 없음) ──────────────────────────────
set "SCRIPT_DIR=%~dp0"
set "APP_DIR=%SCRIPT_DIR%_app"
set "CONFIG_DIR=%USERPROFILE%\.riss"
set "PORT_FILE=%CONFIG_DIR%\port"
set "RISS_DIR_FILE=%CONFIG_DIR%\riss-dir"
set "LOG_FILE=%CONFIG_DIR%\server.log"

if not exist "%CONFIG_DIR%" mkdir "%CONFIG_DIR%"

echo.
echo ===== RISS 논문수집기 시작 =====
echo.

:: ── 1. 경로 등록 처리 ────────────────────────────────────────────
if not exist "%RISS_DIR_FILE%" (
    echo %SCRIPT_DIR%> "%RISS_DIR_FILE%"
    echo [RISS] 최초 설치 경로 저장
) else (
    set /p STORED_DIR=<"%RISS_DIR_FILE%"
    if /i "!STORED_DIR!" neq "%SCRIPT_DIR%" (
        if exist "!STORED_DIR!_app" (
            powershell -NoProfile -Command ^
              "Add-Type -AssemblyName System.Windows.Forms; ^
               $r = [System.Windows.Forms.MessageBox]::Show( ^
                 'RISS 논문수집기 위치가 변경됐습니다.' + [char]10 + [char]10 + ^
                 '이전: !STORED_DIR!' + [char]10 + ^
                 '현재: %SCRIPT_DIR%' + [char]10 + [char]10 + ^
                 '현재 위치로 계속 실행할까요?', ^
                 'RISS 논문수집기', ^
                 [System.Windows.Forms.MessageBoxButtons]::YesNo, ^
                 [System.Windows.Forms.MessageBoxIcon]::Warning); ^
               if ($r -eq 'No') { exit 1 }"
            if errorlevel 1 (
                echo [RISS] 사용자 취소
                exit /b 0
            )
        )
        echo %SCRIPT_DIR%> "%RISS_DIR_FILE%"
    )
)

:: ── 2. _app 폴더 확인 ────────────────────────────────────────────
if not exist "%APP_DIR%" (
    powershell -NoProfile -Command ^
      "Add-Type -AssemblyName System.Windows.Forms; ^
       [System.Windows.Forms.MessageBox]::Show( ^
         '_app 폴더를 찾을 수 없습니다.' + [char]10 + [char]10 + ^
         '앱과 _app 폴더가 같은 위치에 있어야 합니다.' + [char]10 + ^
         '현재 위치: %SCRIPT_DIR%', ^
         'RISS 논문수집기', ^
         [System.Windows.Forms.MessageBoxButtons]::OK, ^
         [System.Windows.Forms.MessageBoxIcon]::Error)"
    exit /b 1
)

:: ── 3. Node.js 확인 & 자동 설치 ──────────────────────────────────
where node >nul 2>&1
if errorlevel 1 (
    echo [RISS] Node.js 없음. winget으로 자동 설치 시작...

    where winget >nul 2>&1
    if errorlevel 1 (
        powershell -NoProfile -Command ^
          "Add-Type -AssemblyName System.Windows.Forms; ^
           [System.Windows.Forms.MessageBox]::Show( ^
             'winget을 찾을 수 없습니다.' + [char]10 + [char]10 + ^
             'nodejs.org 에서 LTS 버전을 직접 설치한 뒤 다시 실행하세요.', ^
             'RISS 논문수집기', ^
             [System.Windows.Forms.MessageBoxButtons]::OK, ^
             [System.Windows.Forms.MessageBoxIcon]::Error)"
        start https://nodejs.org
        exit /b 1
    )

    echo Node.js 설치 중... (약 1-2분 소요)
    winget install OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
    if errorlevel 1 (
        powershell -NoProfile -Command ^
          "Add-Type -AssemblyName System.Windows.Forms; ^
           [System.Windows.Forms.MessageBox]::Show( ^
             'Node.js 자동 설치에 실패했습니다.' + [char]10 + [char]10 + ^
             'nodejs.org 에서 LTS 버전을 직접 설치한 뒤 다시 실행하세요.', ^
             'RISS 논문수집기', ^
             [System.Windows.Forms.MessageBoxButtons]::OK, ^
             [System.Windows.Forms.MessageBoxIcon]::Error)"
        start https://nodejs.org
        exit /b 1
    )

    :: 현재 세션 PATH에 Node.js 경로 즉시 추가
    for %%G in (
        "%ProgramFiles%\nodejs"
        "%ProgramFiles(x86)%\nodejs"
        "%LOCALAPPDATA%\Programs\nodejs"
    ) do (
        if exist "%%~G\node.exe" (
            set "PATH=%%~G;!PATH!"
            echo [RISS] Node.js 경로 추가: %%~G
        )
    )

    where node >nul 2>&1
    if errorlevel 1 (
        powershell -NoProfile -Command ^
          "Add-Type -AssemblyName System.Windows.Forms; ^
           [System.Windows.Forms.MessageBox]::Show( ^
             'Node.js 설치 완료. 적용을 위해 창을 닫고 다시 실행하세요.', ^
             'RISS 논문수집기', ^
             [System.Windows.Forms.MessageBoxButtons]::OK, ^
             [System.Windows.Forms.MessageBoxIcon]::Information)"
        exit /b 0
    )
    echo [RISS] Node.js 설치 완료
)

:: npm global bin 경로 추가 (Claude CLI용)
:: npm bin -g는 npm v9+에서 deprecated → %APPDATA%\npm 직접 사용
set "PATH=%APPDATA%\npm;!PATH!"

:: ── 4. npm install ────────────────────────────────────────────────
if not exist "%APP_DIR%\node_modules\express\package.json" (
    echo [RISS] 패키지 설치 중...
    cd /d "%APP_DIR%"
    npm install --production
    if errorlevel 1 (
        echo [오류] 패키지 설치 실패. 로그: %LOG_FILE%
        pause
        exit /b 1
    )
    echo [RISS] 패키지 설치 완료
)

:: ── 5. Playwright 브라우저 확인 & 설치 ───────────────────────────
set "PW_CACHE=%LOCALAPPDATA%\ms-playwright"
if not exist "%PW_CACHE%" (
    echo [RISS] 브라우저 설치 중... (약 2-3분 소요)
    cd /d "%APP_DIR%"
    npx playwright install chromium
    if errorlevel 1 (
        echo [경고] Playwright 설치 실패. RISS 로그인 기능이 제한될 수 있습니다.
    ) else (
        echo [RISS] 브라우저 설치 완료
    )
)

:: ── 6. Claude CLI 확인 & 설치 ────────────────────────────────────
where claude >nul 2>&1
if errorlevel 1 (
    echo [RISS] Claude CLI 설치 중...
    npm install -g @anthropic-ai/claude-code
    if errorlevel 1 (
        echo [경고] Claude CLI 설치 실패. API 키로 계속 사용 가능합니다.
    ) else (
        echo [RISS] Claude CLI 설치 완료
    )
)

:: ── 7. 이미 실행 중인지 확인 ─────────────────────────────────────
if exist "%PORT_FILE%" (
    set /p EXISTING_PORT=<"%PORT_FILE%"
    curl -sf "http://127.0.0.1:!EXISTING_PORT!/api/config" >nul 2>&1
    if not errorlevel 1 (
        echo [RISS] 이미 실행 중. 브라우저 열기...
        start "" "http://127.0.0.1:!EXISTING_PORT!"
        exit /b 0
    )
    del "%PORT_FILE%"
)

:: ── 8. 서버 시작 ──────────────────────────────────────────────────
echo [RISS] 서버 시작 중...
cd /d "%APP_DIR%"
start "" /min cmd /c "node launcher\server.js >> ""%LOG_FILE%"" 2>&1"

:: ── 9. 포트 파일 대기 (최대 30초) ────────────────────────────────
set /a ATTEMPTS=0
:WAIT_LOOP
set /a ATTEMPTS+=1
if %ATTEMPTS% gtr 60 goto TIMEOUT
timeout /t 1 /nobreak >nul
if not exist "%PORT_FILE%" goto WAIT_LOOP

set /p PORT=<"%PORT_FILE%"
curl -sf "http://127.0.0.1:%PORT%/api/config" >nul 2>&1
if errorlevel 1 (
    if %ATTEMPTS% lss 60 goto WAIT_LOOP
)

echo [RISS] 서버 시작 완료: http://127.0.0.1:%PORT%
start "" "http://127.0.0.1:%PORT%"
exit /b 0

:TIMEOUT
echo [오류] 서버 시작 타임아웃
echo 로그: %LOG_FILE%
pause
exit /b 1
