const { execSync, execFileSync } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');

const IS_WIN = os.platform() === 'win32';
const SERVICE = 'riss-launcher';
const WIN_CREDS_DIR = path.join(os.homedir(), '.riss', 'creds');

// execFileSync(셸 미경유)로 호출 — 비밀번호에 $, 백틱, 따옴표가 있어도 안전
function macSet(account, password) {
  execFileSync(
    'security',
    ['add-generic-password', '-s', SERVICE, '-a', account, '-w', password, '-U'],
    { stdio: 'pipe' }
  );
}
function macGet(account) {
  try {
    return execFileSync(
      'security',
      ['find-generic-password', '-s', SERVICE, '-a', account, '-w'],
      { stdio: 'pipe' }
    ).toString().trim();
  } catch { return null; }
}
function macDelete(account) {
  try {
    execFileSync(
      'security',
      ['delete-generic-password', '-s', SERVICE, '-a', account],
      { stdio: 'pipe' }
    );
  } catch {}
}

function winRunPs(script) {
  const tmp = path.join(os.tmpdir(), `riss_creds_${Date.now()}.ps1`);
  fs.writeFileSync(tmp, script, 'utf8');
  try {
    return execSync(`powershell -ExecutionPolicy Bypass -File "${tmp}"`, { encoding: 'utf8', stdio: 'pipe' }).trim();
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}
// 계정별 파일로 분리 저장 — 도서관 PW와 API 키가 서로 덮어쓰지 않도록 함
function winCredFile(account) {
  return path.join(WIN_CREDS_DIR, `${encodeURIComponent(account)}.dat`);
}
function winSet(account, password) {
  fs.mkdirSync(WIN_CREDS_DIR, { recursive: true });
  const pwFile = winCredFile(account).replace(/\\/g, '\\\\');
  const safePw = password.replace(/'/g, "''");
  winRunPs(`
Add-Type -AssemblyName System.Security
$bytes = [System.Text.Encoding]::UTF8.GetBytes('${safePw}')
$enc   = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[System.IO.File]::WriteAllBytes('${pwFile}', $enc)
`);
}
function winGet(account) {
  let pwFile = winCredFile(account);
  if (!fs.existsSync(pwFile)) {
    // 구버전(pw.dat 단일 파일) 마이그레이션 호환
    const legacy = path.join(WIN_CREDS_DIR, 'pw.dat');
    const legacyAccount = path.join(WIN_CREDS_DIR, 'account.txt');
    try {
      if (fs.existsSync(legacy) && fs.existsSync(legacyAccount) &&
          fs.readFileSync(legacyAccount, 'utf8').trim() === account) {
        pwFile = legacy;
      } else return null;
    } catch { return null; }
  }
  try {
    return winRunPs(`
Add-Type -AssemblyName System.Security
$enc   = [System.IO.File]::ReadAllBytes('${pwFile.replace(/\\/g, '\\\\')}')
$bytes = [System.Security.Cryptography.ProtectedData]::Unprotect($enc, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[System.Text.Encoding]::UTF8.GetString($bytes)
`);
  } catch { return null; }
}
function winDelete(account) {
  try { fs.rmSync(winCredFile(account), { force: true }); } catch {}
}

function keychainSet(account, password) {
  try {
    if (IS_WIN) winSet(account, password);
    else macSet(account, password);
    return true;
  } catch (e) {
    throw new Error(`자격증명 저장 실패: ${e.message}`);
  }
}
function keychainGet(account) { return IS_WIN ? winGet(account) : macGet(account); }
function keychainDelete(account) { if (IS_WIN) winDelete(account); else macDelete(account); }
function keychainHas(account) { return keychainGet(account) !== null; }

module.exports = { keychainSet, keychainGet, keychainDelete, keychainHas };
