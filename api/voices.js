// お客様の声メモ：保存と一覧の取得（Vercel Functions）
// 必要な環境変数：ANTHROPIC_API_KEY / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
// 任意：APP_PASSCODE（設定すると、合言葉を知っている人だけが使える）

import { CATEGORIES, OUTCOMES, SECTIONS, guard, supabase, claude, parseJson } from './_lib.js';

async function classify(content, section) {
  const text = await claude({
    model: 'claude-haiku-5-5',
    maxTokens: 300,
    system:
      'あなたはスーパーマーケットの店長補佐です。店員が記録したお客様の声や現場の困りごとを分類します。' +
      `分類は次のいずれか1つ：${CATEGORIES.join('、')}。` +
      '要約は30文字以内の日本語で、何が起きたかが一目で分かるように書きます。' +
      '出力はJSONのみ：{"category":"…","summary":"…"}',
    content: section ? `売場：${section}\n内容：${content}` : content,
  });
  const parsed = parseJson(text) || {};
  const category = CATEGORIES.includes(parsed.category) ? parsed.category : 'その他';
  const summary = String(parsed.summary || content).slice(0, 60);
  return { category, summary };
}

export default async function handler(req, res) {
  if (guard(req, res)) return;

  try {
    if (req.method === 'GET') {
      const r = await supabase('voices?select=*&order=created_at.desc&limit=50');
      if (!r.ok) throw new Error(`一覧の取得に失敗しました（${r.status}）`);
      return res.status(200).json(await r.json());
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const content = String(body.content || '').trim();
      if (!content) return res.status(400).json({ error: '内容を入力してください' });
      if (content.length > 1000) return res.status(400).json({ error: '1000文字以内で入力してください' });
      const outcome = OUTCOMES.includes(body.outcome) ? body.outcome : null;
      const section = SECTIONS.includes(body.section) ? body.section : null;

      const { category, summary } = await classify(content, section);
      const r = await supabase('voices', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ content, category, summary, outcome, section }),
      });
      if (!r.ok) {
        const detail = await r.text();
        if (detail.includes('outcome') || detail.includes('section')) {
          throw new Error('Supabaseの表に「対応結果」「売場」の列がまだありません。追加の文を実行してください');
        }
        throw new Error(`保存に失敗しました（${r.status}）`);
      }
      const [row] = await r.json();
      return res.status(200).json(row);
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'この操作はできません' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
