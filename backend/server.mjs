import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteRoot = path.join(projectRoot, 'app');
const port = Number(process.env.PORT || 8787);
const baseUrl = (process.env.CGU_LLM_BASE_URL || 'https://air.cgu.edu.tw/cgullmapi/v1').replace(/\/$/, '');
const model = process.env.CGU_MODEL || 'gpt-5.6-luna';
const allowedOrigin = process.env.ASKPROF_ALLOWED_ORIGIN || '*';
const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const rateWindow = 60_000;
const rateLimit = 30;
const requests = new Map();

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

function health(req, res) {
  return sendJson(res, 200, { ok: true, databaseConfigured: Boolean(supabaseUrl && supabaseServiceKey) });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS'
  });
  res.end(JSON.stringify(payload));
}

function clientAddress(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
}

function withinRateLimit(req) {
  const now = Date.now();
  const key = clientAddress(req);
  const recent = (requests.get(key) || []).filter(time => now - time < rateWindow);
  if (recent.length >= rateLimit) return false;
  recent.push(now);
  requests.set(key, recent);
  return true;
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 120_000) throw new Error('request_too_large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function cleanList(value, max) {
  return Array.isArray(value) ? value.slice(0, max) : [];
}

function makePrompt(payload) {
  const feedback = cleanList(payload.feedback, 20).map(item => ({
    subject: String(item.subject || '').slice(0, 80),
    topic: String(item.topic || '').slice(0, 160),
    confidence: Math.max(1, Math.min(5, Number(item.confidence) || 3)),
    difficulty: String(item.difficulty || '').slice(0, 300),
    nextStep: String(item.nextStep || '').slice(0, 300),
    createdAt: item.createdAt
  }));
  const appointments = cleanList(payload.appointments, 20).map(item => ({
    topic: String(item.topic || '').slice(0, 120),
    professor: String(item.professor || '').slice(0, 80),
    date: String(item.date || '').slice(0, 30)
  }));
  const courses = cleanList(payload.courses, 80).map(item => ({
    code: String(item.code || '').slice(0, 30),
    name: String(item.name || '').slice(0, 100),
    credit: Number(item.credit) || 0,
    status: String(item.status || '').slice(0, 20)
  }));
  return `你是長庚大學 AskProf 的學習分析助理。請根據學生自己輸入的學習回饋、預約主題與修課狀態，產生繁體中文、具體且鼓勵性的分析。不要推測醫療、人格或敏感身分資訊，也不要把推測當成事實。只輸出合法 JSON，不要 Markdown，不要額外說明。JSON 格式必須完全符合：
{"summary":"80至160字摘要","subjects":[{"subject":"科目名稱","status":"需要加強|穩定練習|掌握良好","reason":"根據回饋的具體原因","nextStep":"一個可執行的小行動"}],"recommendations":["建議一","建議二"]}
如果資料不足，請誠實說明資料不足，subjects 可為空陣列。最多列出 8 個 subjects、3 個 recommendations。
學生回饋：${JSON.stringify(feedback)}
預約紀錄：${JSON.stringify(appointments)}
修課狀態：${JSON.stringify(courses)}`;
}

function responseText(data) {
  if (typeof data.output_text === 'string') return data.output_text;
  return (data.output || []).flatMap(item => item.content || [])
    .filter(content => content.type === 'output_text' || content.type === 'text')
    .map(content => content.text || '').join('');
}

function parseModelJson(text) {
  const cleaned = String(text || '').replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('invalid_model_json');
  return JSON.parse(cleaned.slice(start, end + 1));
}

function normalizeResult(value) {
  const status = new Set(['需要加強', '穩定練習', '掌握良好']);
  return {
    summary: String(value.summary || '目前資料不足，請持續留下學習回饋。').slice(0, 500),
    subjects: cleanList(value.subjects, 8).map(item => ({
      subject: String(item.subject || '未分類').slice(0, 80),
      status: status.has(item.status) ? item.status : '穩定練習',
      reason: String(item.reason || '').slice(0, 240),
      nextStep: String(item.nextStep || '').slice(0, 240)
    })),
    recommendations: cleanList(value.recommendations, 3).map(item => String(item).slice(0, 240))
  };
}

async function analyzeLearning(req, res) {
  if (!process.env.CGU_API_KEY) return sendJson(res, 500, { error: 'server_not_configured', message: 'CGU_API_KEY 尚未設定。' });
  if (!withinRateLimit(req)) return sendJson(res, 429, { error: 'rate_limited', message: '請稍後再試。' });
  let payload;
  try { payload = await readBody(req); } catch (error) {
    return sendJson(res, error.message === 'request_too_large' ? 413 : 400, { error: 'invalid_request' });
  }
  try {
    const upstream = await fetch(`${baseUrl}/responses`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.CGU_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: makePrompt(payload), max_output_tokens: 900 })
    });
    const data = await upstream.json();
    if (!upstream.ok) return sendJson(res, 502, { error: 'llm_upstream_error', status: upstream.status });
    const result = normalizeResult(parseModelJson(responseText(data)));
    return sendJson(res, 200, { ...result, model, generatedAt: new Date().toISOString() });
  } catch (error) {
    console.error('AskProf AI analysis failed:', error.message);
    return sendJson(res, 502, { error: 'llm_response_invalid' });
  }
}

function supabaseHeaders(extra = {}) {
  return {
    apikey: supabaseServiceKey,
    Authorization: `Bearer ${supabaseServiceKey}`,
    'Content-Type': 'application/json',
    ...extra
  };
}

async function getFacultyAvailability(req, res) {
  if (!supabaseUrl || !supabaseServiceKey) return sendJson(res, 503, { error: 'database_not_configured' });
  const requestUrl = new URL(req.url, 'http://localhost');
  const key = requestUrl.searchParams.get('key') || '';
  if (!key || key.length > 120) return sendJson(res, 400, { error: 'invalid_faculty_key' });
  try {
    const query = new URLSearchParams({ select: 'faculty_key,faculty_email,slot_label,status', faculty_key: `eq.${key}`, order: 'slot_label.asc' });
    const upstream = await fetch(`${supabaseUrl}/rest/v1/faculty_availability?${query}`, { headers: supabaseHeaders() });
    if (!upstream.ok) {
      const detail = await upstream.text();
      console.error(`Supabase availability read returned ${upstream.status}: ${detail.slice(0, 500)}`);
      return sendJson(res, 502, { error: 'database_read_failed', upstreamStatus: upstream.status });
    }
    return sendJson(res, 200, { slots: await upstream.json() });
  } catch (error) {
    console.error('AskProf availability read failed:', error.message);
    return sendJson(res, 502, { error: 'database_unavailable' });
  }
}

async function saveDemoFacultyAvailability(req, res) {
  if (!supabaseUrl || !supabaseServiceKey) return sendJson(res, 503, { error: 'database_not_configured' });
  if (!withinRateLimit(req)) return sendJson(res, 429, { error: 'rate_limited' });
  let payload;
  try { payload = await readBody(req); } catch { return sendJson(res, 400, { error: 'invalid_request' }); }
  // The public demo account can only change its clearly labelled demo record.
  // Real faculty write access must wait for verified CGU SSO sessions.
  if (payload.facultyKey !== 'demo:faculty' || payload.facultyEmail !== 'faculty.demo@askprof.test') {
    return sendJson(res, 403, { error: 'verified_faculty_login_required' });
  }
  if (!Array.isArray(payload.slots) || payload.slots.length > 80) return sendJson(res, 400, { error: 'invalid_slots' });
  const rows = payload.slots.map(slot => ({
    faculty_key: 'demo:faculty',
    faculty_email: 'faculty.demo@askprof.test',
    slot_label: String(slot.label || '').slice(0, 120),
    status: ['open', 'paused', 'booked'].includes(slot.status) ? slot.status : 'open',
    updated_at: new Date().toISOString()
  })).filter(slot => slot.slot_label);
  try {
    if (rows.length) {
      const query = new URLSearchParams({ on_conflict: 'faculty_key,slot_label' });
      const upstream = await fetch(`${supabaseUrl}/rest/v1/faculty_availability?${query}`, {
        method: 'POST',
        headers: supabaseHeaders({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify(rows)
      });
      if (!upstream.ok) {
        const detail = await upstream.text();
        console.error(`Supabase availability write returned ${upstream.status}: ${detail.slice(0, 500)}`);
        return sendJson(res, 502, { error: 'database_write_failed', upstreamStatus: upstream.status });
      }
    }
    return sendJson(res, 200, { saved: rows.length });
  } catch (error) {
    console.error('AskProf availability write failed:', error.message);
    return sendJson(res, 502, { error: 'database_unavailable' });
  }
}

async function serveStatic(req, res) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400); return res.end('Bad request'); }
  const requested = pathname === '/' ? '/index.html' : pathname;
  const file = path.resolve(siteRoot, `.${requested}`);
  if (!file.startsWith(siteRoot) || !path.extname(file)) { res.writeHead(404); return res.end('Not found'); }
  try {
    const content = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': mimeTypes[path.extname(file)] || 'application/octet-stream' });
    res.end(content);
  } catch { res.writeHead(404); res.end('Not found'); }
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return sendJson(res, 204, {});
  if (req.method === 'GET' && new URL(req.url, 'http://localhost').pathname === '/api/health') return health(req, res);
  if (req.method === 'POST' && new URL(req.url, 'http://localhost').pathname === '/api/analyze-learning') return analyzeLearning(req, res);
  if (req.method === 'GET' && new URL(req.url, 'http://localhost').pathname === '/api/faculty-availability') return getFacultyAvailability(req, res);
  if (req.method === 'PUT' && new URL(req.url, 'http://localhost').pathname === '/api/faculty-availability') return saveDemoFacultyAvailability(req, res);
  if (req.method === 'GET') return serveStatic(req, res);
  return sendJson(res, 405, { error: 'method_not_allowed' });
});

server.listen(port, '0.0.0.0', () => console.log(`AskProf backend listening on http://localhost:${port}`));
