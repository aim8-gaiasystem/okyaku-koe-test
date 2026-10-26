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

// 合言葉とキーの確認。問題があれば応答を返して true を返す
export function guard(req, res) {
  const problem = keyProblem();
  if (problem) { res.status(500).json({ error: problem }); return true; }
  const passcode = process.env.APP_PASSCODE;
  if (passcode && req.headers['x-passcode'] !== passcode) {
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

export function parseJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  try { return JSON.parse(match ? match[0] : text); } catch { return null; }
}
