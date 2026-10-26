// お客様の声メモ：保存と一覧の取得（Vercel Functions）
// 必要な環境変数：ANTHROPIC_API_KEY / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
// 任意：APP_PASSCODE（設定すると、合言葉を知っている人だけが使える）

const CATEGORIES = ['商品', '接客', '価格', '店内環境', 'その他'];

function supabase(path, init = {}) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/${path}`;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // 旧形式（eyJ…で始まるservice_roleキー）はAuthorizationにも入れる。
  // 新形式（sb_secret_…で始まるSecretキー）はapikeyだけで送る。
  const auth = key && key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {};
  return fetch(url, {
    ...init,
    headers: {
      apikey: key,
      ...auth,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
}

async function classify(content) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-5-5',
      max_tokens: 300,
      system:
        'あなたはスーパーマーケットの店長補佐です。店員が記録したお客様の声や現場の困りごとを分類します。' +
        `分類は次のいずれか1つ：${CATEGORIES.join('、')}。` +
        '要約は30文字以内の日本語で、何が起きたかが一目で分かるように書きます。' +
        '出力はJSONのみ：{"category":"…","summary":"…"}',
      messages: [{ role: 'user', content }],
    }),
  });
  if (!res.ok) throw new Error(`AIの呼び出しに失敗しました（${res.status}）`);
  const data = await res.json();
  const text = (data.content || []).map((c) => c.text || '').join('');
  const match = text.match(/\{[\s\S]*\}/);
  let parsed = {};
  try { parsed = JSON.parse(match ? match[0] : text); } catch { /* 下で補う */ }
  const category = CATEGORIES.includes(parsed.category) ? parsed.category : 'その他';
  const summary = String(parsed.summary || content).slice(0, 60);
  return { category, summary };
}

// 秘密のキーの欄に、公開用のキーが入っていないかを確かめる
function keyProblem() {
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

export default async function handler(req, res) {
  const problem = keyProblem();
  if (problem) return res.status(500).json({ error: problem });

  const passcode = process.env.APP_PASSCODE;
  if (passcode && req.headers['x-passcode'] !== passcode) {
    return res.status(401).json({ error: '合言葉が違います' });
  }

  try {
    if (req.method === 'GET') {
      const r = await supabase('voices?select=*&order=created_at.desc&limit=50');
      if (!r.ok) throw new Error(`一覧の取得に失敗しました（${r.status}）`);
      return res.status(200).json(await r.json());
    }

    if (req.method === 'POST') {
      const content = String((req.body && req.body.content) || '').trim();
      if (!content) return res.status(400).json({ error: '内容を入力してください' });
      if (content.length > 1000) return res.status(400).json({ error: '1000文字以内で入力してください' });

      const { category, summary } = await classify(content);
      const r = await supabase('voices', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ content, category, summary }),
      });
      if (!r.ok) throw new Error(`保存に失敗しました（${r.status}）`);
      const [row] = await r.json();
      return res.status(200).json(row);
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'この操作はできません' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
