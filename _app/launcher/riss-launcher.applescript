-- RISS 논문수집기 AppleScript Launcher
-- 컴파일: osacompile -o "RISS 논문수집기.app" _app/launcher/riss-launcher.applescript

on run
	set configDir to (POSIX path of (path to home folder)) & ".riss"
	set portFile to configDir & "/port"
	set logFile to configDir & "/server.log"
	set rissDirFile to configDir & "/riss-dir"
	set firstRunFlag to configDir & "/.first_run_done"

	-- 설정 디렉토리 생성
	do shell script "mkdir -p " & quoted form of configDir

	-- 이미 실행 중인 서버 확인
	try
		set existingPort to do shell script "cat " & quoted form of portFile & " 2>/dev/null"
		if existingPort is not "" then
			try
				do shell script "curl -sf http://127.0.0.1:" & existingPort & "/api/config >/dev/null 2>&1"
				open location "http://127.0.0.1:" & existingPort
				return
			end try
		end if
	end try
	do shell script "rm -f " & quoted form of portFile & " 2>/dev/null; true"

	-- _app 경로 탐지 (App Translocation 우회)
	-- 1순위: 앱 실제 위치 기준 상대 경로
	set appPath to POSIX path of (path to me)
	set rissDir to do shell script "dirname " & quoted form of appPath
	set appDir to rissDir & "/_app"

	-- 2순위: RISS-search.command가 기록해둔 실제 설치 경로
	set appDirFound to false
	try
		do shell script "test -d " & quoted form of appDir
		set appDirFound to true
	end try

	if not appDirFound then
		try
			set savedDir to do shell script "cat " & quoted form of rissDirFile & " 2>/dev/null"
			if savedDir is not "" then
				set appDir to savedDir & "/_app"
				try
					do shell script "test -d " & quoted form of appDir
					set appDirFound to true
				end try
			end if
		end try
	end if

	if not appDirFound then
		display dialog "RISS 논문수집기 폴더를 찾을 수 없습니다." & return & return & "먼저 RISS-search.command를 한 번 실행해 주세요." & return & "(다운로드 폴더에서 우클릭 → 열기)" with title "RISS 논문수집기" buttons {"확인"} default button "확인" with icon stop
		return
	end if

	set serverScript to appDir & "/launcher/server.js"

	-- Node.js 탐지 (PATH 확장 포함)
	set pathSetup to "export PATH=/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:$PATH; [ -s $HOME/.nvm/nvm.sh ] && . $HOME/.nvm/nvm.sh --no-use; [ -d $HOME/.volta/bin ] && export PATH=$HOME/.volta/bin:$PATH; [ -d $HOME/.fnm ] && eval \"$(fnm env 2>/dev/null)\""
	set nodeExec to ""
	try
		set nodeExec to do shell script pathSetup & "; which node"
	end try

	if nodeExec is "" then
		display dialog "Node.js가 필요합니다." & return & return & "nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행해 주세요." with title "RISS 논문수집기" buttons {"확인"} default button "확인" with icon stop
		return
	end if

	-- 패키지 설치 (최초 1회)
	try
		do shell script "test -d " & quoted form of (appDir & "/node_modules")
	on error
		display notification "패키지 설치 중입니다. 잠시 기다려 주세요..." with title "RISS 논문수집기"
		try
			do shell script pathSetup & "; cd " & quoted form of appDir & " && npm install --production --silent 2>>" & quoted form of logFile
		end try
	end try

	-- Playwright 브라우저 확인
	try
		do shell script "test -d $HOME/.cache/ms-playwright || test -d $HOME/Library/Caches/ms-playwright"
	on error
		display notification "브라우저를 설치하고 있습니다. 1~2분 소요됩니다..." with title "RISS 논문수집기"
		try
			do shell script pathSetup & "; cd " & quoted form of appDir & " && npx playwright install chromium 2>>" & quoted form of logFile
		end try
	end try

	-- 서버 백그라운드 실행 (절대경로 사용)
	set serverCmd to pathSetup
	set serverCmd to serverCmd & "; nohup " & quoted form of nodeExec
	set serverCmd to serverCmd & " " & quoted form of serverScript
	set serverCmd to serverCmd & " >> " & quoted form of logFile & " 2>&1 &"
	do shell script serverCmd

	-- 서버 준비 대기 (최대 15초)
	set attempts to 0
	repeat while attempts < 30
		delay 0.5
		set attempts to attempts + 1
		try
			set portContent to do shell script "cat " & quoted form of portFile & " 2>/dev/null"
			if portContent is not "" then
				try
					do shell script "curl -sf http://127.0.0.1:" & portContent & "/api/config >/dev/null 2>&1"

					-- 첫 실행 안내 (1회만)
					set isFirstRun to false
					try
						do shell script "test -f " & quoted form of firstRunFlag
					on error
						set isFirstRun to true
						do shell script "touch " & quoted form of firstRunFlag
					end try

					if isFirstRun then
						set choice to button returned of (display dialog "처음 실행하셨군요!" & return & return & "다른 기기에 배포 시 보안 차단이 뜰 경우:" & return & "시스템 설정 → 개인정보 보호 및 보안 → 그래도 열기" & return & return & "지금 시스템 설정을 여시겠어요?" with title "RISS 논문수집기" buttons {"닫기", "시스템 설정 열기"} default button "닫기" with icon note)
						if choice is "시스템 설정 열기" then
							open location "x-apple.systempreferences:com.apple.preference.security"
						end if
					end if

					open location "http://127.0.0.1:" & portContent
					return
				end try
			end if
		end try
	end repeat

	display dialog "서버 시작에 실패했습니다." & return & return & "로그: " & logFile with title "RISS 논문수집기" buttons {"확인"} with icon stop
end run
