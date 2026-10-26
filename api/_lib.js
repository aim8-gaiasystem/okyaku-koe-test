// 共通の部品（ファイル名が _ で始まるので、Vercelでは画面から直接呼ばれない）

export const CATEGORIES = ['商品', '接客', '価格', '店内環境', 'その他'];
export const OUTCOMES = ['対応できた', 'お断りした', 'その他'];
export const SECTIONS = ['惣菜', '青果', '鮮魚', '精肉', '日配', '加工食品', '日用品', 'レジ', '駐車場', 'その他'];

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
