// お客様の声メモ：店員さんの記録と、管理者の一覧（Vercel Functions）
// 必要な環境変数：ANTHROPIC_API_KEY / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
// 任意：APP_PASSCODE（店員さん用の合言葉）、ADMIN_PASSCODE（管理者用の合言葉）

import {
  OUTCOMES, SECTIONS, STAFF_KINDS, guard, roleOf, supabase, countRows,
  classify, savePhoto, signPhotos, insertVoice, maskPersonal,
} from './_lib.js';

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  if (guard(req, res)) return;

  try {
    // 入力画面向け：今月集まった件数だけを返す（中身は返さない）
    if (req.method === 'GET' && req.query && req.query.count === 'month') {
      const now = new Date(Date.now() + 9 * 3600 * 1000); // 日本時間
      const start = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01T00:00:00+09:00`;
      const total = await countRows(`created_at=gte.${encodeURIComponent(start)}`);
      return res.status(200).json({ month: start.slice(0, 7), count: total });
    }

    if (req.method === 'GET') {
      // 記録の一覧は管理者だけが見られる
      if (roleOf(req) !== 'admin') return res.status(403).json({ error: '記録の一覧は管理者だけが見られます' });
      const r = await supabase('voices?select=*&order=created_at.desc&limit=100');
      if (!r.ok) throw new Error(`一覧の取得に失敗しました（${r.status}）`);
      const rows = await r.json();
      const urls = await signPhotos(rows.map((x) => x.photo_path).filter(Boolean));
      return res.status(200).json(rows.map(({ ip_hash, ...x }) => ({ ...x, photo_url: urls[x.photo_path] || null })));
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const kind = STAFF_KINDS.includes(body.kind) ? body.kind : 'お客様の声';
      const item = maskPersonal(String(body.item || '').trim()).slice(0, 100);
      let content = maskPersonal(String(body.content || '').trim());
      if (kind === 'ありません' && !item) return res.status(400).json({ error: '聞かれた商品・サービスを入力してください' });
      if (kind === 'ありません' && !content) content = `「${item}」はありますか、と聞かれたが扱っていなかった`;
      if (!content) return res.status(400).json({ error: '内容を入力してください' });
      if (content.length > 1000) return res.status(400).json({ error: '1000文字以内で入力してください' });
      const section = SECTIONS.includes(body.section) ? body.section : null;
      const outcome = kind === 'ありません' ? 'お断りした' : (OUTCOMES.includes(body.outcome) ? body.outcome : null);

      const photo = body.photo ? await savePhoto(body.photo) : null;
      const { category, summary } = await classify({ content, section, kind, item, photo });
      const saved = await insertVoice({
        content, category, summary, outcome, section, kind, item: item || null,
        source: 'staff', photo_path: photo ? photo.path : null,
      });
      return res.status(200).json({ id: saved.id, category, summary });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'この操作はできません' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
