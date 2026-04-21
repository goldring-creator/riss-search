const { execSync } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');

const IS_WIN = os.platform() === 'win32';
const SERVICE = 'riss-launcher';
const WIN_CREDS_DIR = path.join(os.homedir(), '.riss', 'creds');

function macSet(account, password) {
  execSync(
    `security add-generic-password -s ${SERVICE} -a ${JSON.stringify(account)} -w ${JSON.stringify(password)} -U`,
    { stdio: 'pipe' }
  );
}
function macGet(account) {
  try {
    return execSync(
      `security find-generic-password -s ${SERVICE} -a ${JSON.stringify(account)} -w`,
      { stdio: 'pipe' }
    ).toString().trim();
  } catch { return null; }
}
function macDelete(account) {
  try {
    execSync(
      `security delete-generic-password -s ${SERVICE} -a ${JSON.stringify(account)}`,
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
function winSet(account, password) {
  fs.mkdirSync(WIN_CREDS_DIR, { recursive: true });
  const pwFile = path.join(WIN_CREDS_DIR, 'pw.dat').replace(/\\/g, '\\\\');
  const safePw = password.replace(/'/g, "''");
  winRunPs(`
Add-Type -AssemblyName System.Security
$bytes = [System.Text.Encoding]::UTF8.GetBytes('${safePw}')
$enc   = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[System.IO.File]::WriteAllBytes('${pwFile}', $enc)
`);
  fs.writeFileSync(path.join(WIN_CREDS_DIR, 'account.txt'), account, 'utf8');
}
function winGet(account) {
  const pwFile = path.join(WIN_CREDS_DIR, 'pw.dat');
  if (!fs.existsSync(pwFile)) return null;
  try {
    return winRunPs(`
Add-Type -AssemblyName System.Security
$enc   = [System.IO.File]::ReadAllBytes('${pwFile.replace(/\\/g, '\\\\')}')
$bytes = [System.Security.Cryptography.ProtectedData]::Unprotect($enc, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[System.Text.Encoding]::UTF8.GetString($bytes)
`);
  } catch { return null; }
}
function winDelete() {
  try { fs.rmSync(WIN_CREDS_DIR, { recursive: true, force: true }); } catch {}
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
function keychainDelete(account) { if (IS_WIN) winDelete(); else macDelete(account); }
function keychainHas(account) { return keychainGet(account) !== null; }

module.exports = { keychainSet, keychainGet, keychainDelete, keychainHas };
