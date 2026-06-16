#!/usr/bin/env node
// 도서관 로그인 + RISS 접속 단독 검증 (MCP riss_verify_login에서 자식 프로세스로 호출)
// 사용법: node verify-login.js [--university-id hufs]
const path = require('path');
const os = require('os');
require('dotenv').config();
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(os.homedir(), '.riss', '.env') });
const { chromium } = require('playwright');
const { loginAndGetRiss } = require('../core/riss-auth');
const { launchOptions, contextOptions } = require('../core/browser-config');

const args = process.argv.slice(2);
let universityId = process.env.RISS_UNIVERSITY || 'hufs';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--university-id' && args[i + 1]) universityId = args[++i];
}

(async () => {
  const t0 = Date.now();
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext(contextOptions());
  try {
    const page = await loginAndGetRiss(context, {
      libraryId: process.env.RISS_ID,
      libraryPw: process.env.RISS_PW,
      universityId,
    });
    console.log(JSON.stringify({
      ok: true,
      universityId,
      finalUrl: page.url(),
      elapsedSec: Math.round((Date.now() - t0) / 100) / 10,
    }));
  } catch (err) {
    console.log(JSON.stringify({ ok: false, universityId, error: err.message }));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
