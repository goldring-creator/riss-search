#!/usr/bin/env node
// RISS 논문수집기 MCP 서버 (stdio)
// 도구: riss_verify_login / riss_search / riss_download / riss_status
//
// 등록(Claude Code):
//   claude mcp add riss -- node "<이 폴더 경로>/_app/mcp/server.js"
// 자격증명: ~/.riss/.env 또는 _app/.env 의 RISS_ID / RISS_PW / RISS_UNIVERSITY
//
// 모든 무거운 작업은 자식 프로세스(core/riss-main.js 등)로 실행 —
// core 모듈의 console.log가 MCP stdio(JSON-RPC)를 오염시키지 않도록 격리.

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const APP_DIR = path.join(__dirname, '..');
const CORE = path.join(APP_DIR, 'core');
const JOB_FILE = path.join(os.homedir(), '.riss', 'mcp-job.json');
const JOB_LOG = path.join(os.homedir(), '.riss', 'mcp-job.log');

function text(s) {
  return { content: [{ type: 'text', text: s }] };
}

function runChild(script, args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn('node', [script, ...args], { cwd: APP_DIR, env: process.env });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); }, timeoutMs);
    child.stdout.on('data', d => { out += d.toString(); });
    child.stderr.on('data', d => { err += d.toString(); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, out, err }); });
  });
}

function readJob() {
  try { return JSON.parse(fs.readFileSync(JOB_FILE, 'utf8')); } catch { return null; }
}
function writeJob(job) {
  fs.mkdirSync(path.dirname(JOB_FILE), { recursive: true });
  fs.writeFileSync(JOB_FILE, JSON.stringify(job, null, 2), 'utf8');
}
function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

const server = new McpServer({ name: 'riss-collector', version: '1.0.0' });

// ── riss_verify_login ──────────────────────────────────────
server.registerTool('riss_verify_login', {
  description: '대학 도서관 로그인 + RISS 기관 접속이 정상 작동하는지 검증한다. 자격증명은 ~/.riss/.env(RISS_ID, RISS_PW, RISS_UNIVERSITY)에서 읽는다.',
  inputSchema: {
    universityId: z.string().optional().describe('대학 ID (기본: 환경설정값 또는 hufs). hufs/korea/cnu/snu/skku/khu/pusan/konkuk/kookmin/cbnu'),
  },
}, async ({ universityId }) => {
  const args = universityId ? ['--university-id', universityId] : [];
  const r = await runChild(path.join(__dirname, 'verify-login.js'), args, 120000);
  const lastLine = r.out.trim().split('\n').pop() || '';
  try {
    const j = JSON.parse(lastLine);
    return text(j.ok
      ? `로그인 성공 (${j.universityId}, ${j.elapsedSec}초) — RISS URL: ${j.finalUrl}`
      : `로그인 실패 (${j.universityId}): ${j.error}`);
  } catch {
    return text(`검증 실패 — 출력: ${(r.out + r.err).slice(-500)}`);
  }
});

// ── riss_search ────────────────────────────────────────────
server.registerTool('riss_search', {
  description: 'RISS에서 국내 학술논문을 검색해 메타데이터(metadata.json)를 수집한다. PDF 다운로드는 하지 않는다(riss_download 사용). 키워드 검색 또는 제목 검색 지원. 1페이지당 약 1분 소요.',
  inputSchema: {
    keywords: z.array(z.string()).optional().describe('검색 키워드 목록 (주제 검색)'),
    titles: z.array(z.string()).optional().describe('논문 제목 목록 (정확 검색, 제목당 1페이지)'),
    pages: z.number().int().min(1).max(5).default(1).describe('키워드당 수집 페이지 수 (1-5)'),
    yearFrom: z.string().optional().describe('수집 시작 연도 (예: 2020)'),
    yearTo: z.string().optional().describe('수집 종료 연도'),
    kciOnly: z.boolean().default(false).describe('KCI 등재 논문만'),
    sort: z.enum(['rank', 'newest', 'popular']).default('rank'),
    outputDir: z.string().describe('결과 저장 폴더 (절대 경로)'),
  },
}, async (p) => {
  if ((!p.keywords || p.keywords.length === 0) && (!p.titles || p.titles.length === 0)) {
    return text('keywords 또는 titles 중 하나는 필수입니다.');
  }
  const args = ['--skip-download', '--skip-classify', '--output-dir', p.outputDir, '--pages', String(p.pages || 1)];
  (p.keywords || []).forEach(k => args.push('--keyword', k));
  (p.titles || []).forEach(t => args.push('--title', t));
  if (p.yearFrom) args.push('--year-from', p.yearFrom);
  if (p.yearTo) args.push('--year-to', p.yearTo);
  if (p.kciOnly) args.push('--kci-only');
  if (p.sort) args.push('--sort', p.sort);

  const totalPages = (p.keywords || []).length * (p.pages || 1) + (p.titles || []).length;
  const r = await runChild(path.join(CORE, 'riss-main.js'), args, Math.max(180000, totalPages * 120000));
  if (r.code !== 0) return text(`검색 실패 (코드 ${r.code}):\n${(r.out + r.err).slice(-800)}`);

  const metaPath = path.join(p.outputDir, 'metadata.json');
  try {
    const papers = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    const withDl = papers.filter(x => x.downloadOnclick).length;
    const list = papers.slice(0, 30).map((x, i) =>
      `${i + 1}. ${x.title} (${x.authorDisplay}, ${x.year}) [${x.journal}] 피인용 ${x.kciCitations}${x.downloadOnclick ? '' : ' (원문없음)'}`
    ).join('\n');
    return text(`수집 완료: ${papers.length}건 (원문 다운로드 가능 ${withDl}건)\n메타데이터: ${metaPath}\n\n${list}${papers.length > 30 ? `\n... 외 ${papers.length - 30}건` : ''}`);
  } catch (e) {
    return text(`검색은 종료됐으나 metadata.json 읽기 실패: ${e.message}`);
  }
});

// ── riss_download ──────────────────────────────────────────
server.registerTool('riss_download', {
  description: 'riss_search로 수집한 metadata.json의 논문 PDF를 백그라운드로 다운로드한다. 논문당 약 30초 소요. 진행 상황은 riss_status로 확인.',
  inputSchema: {
    metadataPath: z.string().describe('metadata.json 절대 경로'),
    outputDir: z.string().optional().describe('PDF 저장 폴더 (기본: metadata.json이 있는 폴더)'),
  },
}, async ({ metadataPath, outputDir }) => {
  if (!fs.existsSync(metadataPath)) return text(`metadata.json 없음: ${metadataPath}`);
  const prev = readJob();
  if (prev && prev.pid && pidAlive(prev.pid) && !prev.endedAt) {
    return text(`이미 실행 중인 작업이 있습니다 (PID ${prev.pid}). riss_status로 확인하세요.`);
  }
  const outDir = outputDir || path.dirname(metadataPath);
  fs.writeFileSync(JOB_LOG, '', 'utf8');
  const logFd = fs.openSync(JOB_LOG, 'a');
  const child = spawn('node',
    [path.join(CORE, 'riss-download-cli.js'), '--metadata', metadataPath, '--output-dir', outDir],
    { cwd: APP_DIR, env: process.env, detached: true, stdio: ['ignore', logFd, logFd] });
  child.unref();
  const papers = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  const n = papers.filter(x => x.downloadOnclick).length;
  writeJob({ type: 'download', pid: child.pid, metadataPath, outputDir: outDir, startedAt: new Date().toISOString(), totalTargets: n });
  return text(`다운로드 시작 (대상 ${n}건, 예상 약 ${Math.ceil(n * 35 / 60)}분, PID ${child.pid})\n로그: ${JOB_LOG}\nriss_status로 진행 상황을 확인하세요.`);
});

// ── riss_status ────────────────────────────────────────────
server.registerTool('riss_status', {
  description: '백그라운드 다운로드 작업의 진행 상황과 결과를 확인한다.',
  inputSchema: {},
}, async () => {
  const job = readJob();
  if (!job) return text('실행된 작업이 없습니다.');
  const running = job.pid && pidAlive(job.pid);
  let logTail = '';
  try {
    const log = fs.readFileSync(JOB_LOG, 'utf8');
    logTail = log.split('\n').filter(Boolean).slice(-12).join('\n');
  } catch {}
  let stats = '';
  try {
    const papers = JSON.parse(fs.readFileSync(job.metadataPath, 'utf8'));
    const c = {};
    papers.forEach(x => { const k = x.downloadStatus || '대기'; c[k] = (c[k] || 0) + 1; });
    stats = '상태 집계: ' + Object.entries(c).map(([k, v]) => `${k} ${v}건`).join(', ');
  } catch {}
  return text(`작업: ${job.type} | ${running ? '진행 중' : '종료됨'} (시작: ${job.startedAt})\n${stats}\n\n--- 최근 로그 ---\n${logTail}`);
});

(async () => {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('riss-collector MCP 서버 시작');
})();
