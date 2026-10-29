// 共通の部品（ファイル名が _ で始まるので、Vercelでは画面から直接呼ばれない）

import { createHash } from 'node:crypto';

export const CATEGORIES = ['商品', '接客', '価格', '店内環境', '働きやすさ', 'その他'];
export const OUTCOMES = ['対応できた', 'お断りした', 'その他'];
export const SECTIONS = ['惣菜', '青果', '鮮魚', '精肉', '日配', '加工食品', '日用品', 'レジ', '駐車場', 'その他'];
// 声の種類。店員さん用と、お客様用
export const STAFF_KINDS = ['お客様の声', '困りごと', 'アイデア', 'ありません'];
export const CUSTOMER_KINDS = ['欲しい商品', 'ご意見・ご要望'];
export const PHOTO_BUCKET = 'voice-photos';

// 秘密のキーの欄に、公開用のキーが入っていないかを確かめる
export function keyProblem() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!key) return 'SUPABASE_SERVICE_ROLE_KEY が設定されていません';
  if (key.startsWith('sb_publishable_')) {
    return 'SUPABASE_SERVICE_ROLE_KEY に公開用のキー（sb_publishable_）が入っています。秘密のキー（sb_secret_）に入れ替えてください';
  }
  if (key.startsWith('eyJ')) {
    try {
      const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64').toString());
      if (payload.role !== 'service_role') {
        return `SUPABASE_SERVICE_ROLE_KEY に ${payload.role} 用のキーが入っています。service_role のキーに入れ替えてください`;
      }
    } catch { /* 判定できない場合はそのまま進める */ }
  }
  return '';
}

// 合言葉から役割を決める。admin（管理者）は staff（入力）の操作もできる
export function roleOf(req) {
  const given = req.headers['x-passcode'] || '';
  const admin = process.env.ADMIN_PASSCODE;
  const staff = process.env.APP_PASSCODE;
  if (admin && given === admin) return 'admin';
  if (!staff || given === staff) return 'staff';
  return null;
}

// 合言葉とキーの確認。need は 'staff' または 'admin'。問題があれば応答を返して true を返す
export function guard(req, res, need = 'staff') {
  const problem = keyProblem();
  if (problem) { res.status(500).json({ error: problem }); return true; }
  if (need === 'admin' && !process.env.ADMIN_PASSCODE) {
    res.status(500).json({ error: 'Vercelに ADMIN_PASSCODE（管理者用の合言葉）が設定されていません' });
    return true;
  }
  const role = roleOf(req);
  if (!role || (need === 'admin' && role !== 'admin')) {
    res.status(401).json({ error: '合言葉が違います' });
    return true;
  }
  return false;
}

export function supabase(path, init = {}) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/${path}`;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // 旧形式（eyJ…）はAuthorizationにも入れる。新形式（sb_secret_…）はapikeyだけで送る
  const auth = key && key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {};
  return fetch(url, {
    ...init,
    headers: { apikey: key, ...auth, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
}

export async function claude({ model, system, content, maxTokens }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content }] }),
  });
  if (!res.ok) throw new Error(`AIの呼び出しに失敗しました（${res.status}）`);
  const data = await res.json();
  return (data.content || []).map((c) => c.text || '').join('');
}

// 決まった形式（JSON）で必ず答えさせる呼び出し方。tool の input_schema に沿った結果を返す
export async function claudeStructured({ model, system, content, maxTokens, tool }) {
  const call = (toolChoice) => fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: `${system}\n必ず ${tool.name} ツールを1回だけ使って結果を返すこと。`,
      tools: [tool],
      tool_choice: toolChoice,
      messages: [{ role: 'user', content }],
    }),
  });

  // まずツールの使用を強制して頼む。受け付けられなければ、任意の指定でやり直す
  let res = await call({ type: 'tool', name: tool.name });
  if (res.status === 400) {
    console.error('Forced tool_choice rejected:', await res.text());
    res = await call({ type: 'auto' });
  }
  if (!res.ok) {
    const detail = await res.text();
    console.error('Anthropic error', res.status, detail);
    let msg = '';
    try { msg = JSON.parse(detail).error.message; } catch { msg = detail.slice(0, 200); }
    throw new Error(`AIの呼び出しに失敗しました（${res.status}）：${msg}`);
  }
  const data = await res.json();
  const block = (data.content || []).find((c) => c.type === 'tool_use');
  if (!block) {
    console.error('No tool_use block', data.stop_reason, JSON.stringify(data).slice(0, 2000));
    throw new Error(`AIのレポートを読み取れませんでした（${data.stop_reason || '理由不明'}）`);
  }
  if (data.stop_reason === 'max_tokens') {
    throw new Error('AIのレポートが長すぎて途中で切れました。もう一度お試しください');
  }
  return block.input;
}

export function parseJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  try { return JSON.parse(match ? match[0] : text); } catch { return null; }
}

// 電話番号・メールアドレスらしき部分を伏せる（個人情報を残さないため）
export function maskPersonal(text) {
  return String(text || '')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '［メール］')
    .replace(/(\+?81[-\s]?|0)\d{1,4}[-\s(（]?\d{1,4}[-\s)）]?\d{3,4}/g, '［電話番号］');
}

// 店の一覧。Vercelの環境変数 STORES に「honten:本店,ekimae:駅前店」の形で書く。未設定なら main（本店）だけ
export function stores() {
  const raw = process.env.STORES || 'main:本店';
  const out = {};
  for (const part of raw.split(',')) {
    const [code, name] = part.split(':').map((x) => (x || '').trim());
    if (/^[a-z0-9-]{1,30}$/.test(code)) out[code] = name || code;
  }
  return out;
}

// 送信元（IPアドレス）を元に戻せない形にする。いたずらの回数制限にだけ使う
export function ipHash(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
  const salt = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').slice(-16);
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 32);
}

// 条件に合う行の件数を数える
export async function countRows(query) {
  const r = await supabase(`voices?select=id&${query}`, { method: 'HEAD', headers: { Prefer: 'count=exact' } });
  const range = r.headers.get('content-range') || '';
  return Number(range.split('/')[1]) || 0;
}

// 写真の置き場（Supabase Storage）
function storage(path, init = {}) {
  const url = `${process.env.SUPABASE_URL}/storage/v1/${path}`;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const auth = key && key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {};
  return fetch(url, {
    ...init,
    headers: { apikey: key, ...auth, ...(init.headers || {}) },
  });
}

// 画面から届いた写真（data:image/jpeg;base64,...）を、非公開の置き場に保存して場所を返す
export async function savePhoto(dataUrl) {
  const m = /^data:(image\/(jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new Error('写真の形式が読み取れませんでした');
  const bytes = Buffer.from(m[3], 'base64');
  if (bytes.length > 3 * 1024 * 1024) throw new Error('写真が大きすぎます');
  const ext = m[2] === 'jpeg' ? 'jpg' : m[2];
  const now = new Date(Date.now() + 9 * 3600 * 1000).toISOString();
  const path = `${now.slice(0, 7)}/${now.slice(0, 10)}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const upload = () => storage(`object/${PHOTO_BUCKET}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': m[1], 'x-upsert': 'false' },
    body: bytes,
  });
  let r = await upload();
  if (!r.ok) {
    const detail = await r.text();
    // 置き場がまだなければ、非公開で作ってからやり直す
    if (/not.?found|does not exist/i.test(detail)) {
      await storage('bucket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: PHOTO_BUCKET, name: PHOTO_BUCKET, public: false }),
      });
      r = await upload();
    }
    if (!r.ok) {
      console.error('photo upload failed', r.status, detail);
      throw new Error(`写真の保存に失敗しました（${r.status}）`);
    }
  }
  return { path, mediaType: m[1], base64: m[3] };
}

// 管理者画面で写真を見るための、期限つきのURLをまとめて作る
export async function signPhotos(paths) {
  if (!paths.length) return {};
  const r = await storage(`object/sign/${PHOTO_BUCKET}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: 3600, paths }),
  });
  if (!r.ok) return {};
  const list = await r.json();
  const out = {};
  for (const x of list) {
    if (x.signedURL && x.path) out[x.path] = `${process.env.SUPABASE_URL}/storage/v1${x.signedURL}`;
  }
  return out;
}

// 声を分類・要約する。写真があれば一緒にAIに見せる
export async function classify({ content, section, kind, item, photo }) {
  const head = [
    kind && `種類：${kind}`,
    section && `売場：${section}`,
    item && `商品・サービス：${item}`,
  ].filter(Boolean).join('\n');
  const textPart = `${head}${head ? '\n' : ''}内容：${content}`;
  const message = photo
    ? [{ type: 'image', source: { type: 'base64', media_type: photo.mediaType, data: photo.base64 } }, { type: 'text', text: textPart }]
    : textPart;
  const text = await claude({
    model: 'claude-haiku-5-5',
    maxTokens: 300,
    system:
      'あなたはスーパーマーケットの店長補佐です。店員が記録したお客様の声・現場の困りごと・アイデア、' +
      'またはお客様から直接届いた要望を分類します。' +
      `分類は次のいずれか1つ：${CATEGORIES.join('、')}。店員自身の働きにくさ・人手・作業の負担は「働きやすさ」。` +
      '要約は30文字以内の日本語で、何が起きたか・何が求められているかが一目で分かるように書きます。' +
      '人の名前や連絡先は要約に入れません。写真がある場合は、写っている商品や状況も参考にします。' +
      '出力はJSONのみ：{"category":"…","summary":"…"}',
    content: message,
  });
  const parsed = parseJson(text) || {};
  const category = CATEGORIES.includes(parsed.category) ? parsed.category : 'その他';
  const summary = String(parsed.summary || content).slice(0, 60);
  return { category, summary };
}

// 保存に失敗したとき、列が足りないのが原因なら分かりやすく伝える
export async function insertVoice(row) {
  const r = await supabase('voices', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(row),
  });
  if (!r.ok) {
    const detail = await r.text();
    console.error('insert failed', r.status, detail);
    if (/column/i.test(detail)) {
      throw new Error('Supabaseの表に新しい列がまだありません。sql/04_kinds_photos_customer.sql を実行してください');
    }
    throw new Error(`保存に失敗しました（${r.status}）`);
  }
  const [saved] = await r.json();
  return saved;
}
