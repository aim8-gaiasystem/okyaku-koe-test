// お客様用：アプリやQRから届く声（合言葉なし）（Vercel Functions）
// GET  /api/customer?s=main … 店名を返す
// POST /api/customer  {s, kind, item, content, rating} … 声を保存する
// 任意の環境変数：STORES（例 "honten:本店,ekimae:駅前店"）、CUSTOMER_DAILY_LIMIT（1日の受付上限。既定200）

import {
  CUSTOMER_KINDS, keyProblem, stores, ipHash, countRows,
  classify, insertVoice, maskPersonal,
} from './_lib.js';

export const config = { maxDuration: 30 };

const PER_10MIN = 3;   // 同じ送信元から10分間に受け付ける件数
const PER_DAY = 10;    // 同じ送信元から1日に受け付ける件数

const since = (ms) => encodeURIComponent(new Date(Date.now() - ms).toISOString());

export default async function handler(req, res) {
  const problem = keyProblem();
  if (problem) return res.status(500).json({ error: '準備中です。しばらくしてからお試しください' });

  const list = stores();
  const code = String((req.method === 'GET' ? req.query.s : req.body && req.body.s) || '').trim() || Object.keys(list)[0];
  if (!list[code]) return res.status(404).json({ error: 'このリンクは使えません。お店のアプリやQRコードから開き直してください' });

  try {
    if (req.method === 'GET') {
      return res.status(200).json({ store: code, name: list[code], kinds: CUSTOMER_KINDS });
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      if (body.website) return res.status(200).json({ ok: true }); // 機械的な送信（見えない欄に入力あり）は保存しない

      const kind = CUSTOMER_KINDS.includes(body.kind) ? body.kind : 'ご意見・ご要望';
      const item = maskPersonal(String(body.item || '').trim()).slice(0, 100);
      let content = maskPersonal(String(body.content || '').trim());
      const rating = Number.isInteger(body.rating) && body.rating >= 1 && body.rating <= 5 ? body.rating : null;
      if (kind === '欲しい商品' && !item) return res.status(400).json({ error: '欲しい商品を入力してください' });
      if (kind === '欲しい商品' && !content) content = `「${item}」を置いてほしい`;
      if (!content) return res.status(400).json({ error: 'ご意見を入力してください' });
      if (content.length > 500) return res.status(400).json({ error: '500文字以内でお願いします' });

      // いたずら・大量送信の対策
      const hash = ipHash(req);
      if (await countRows(`ip_hash=eq.${hash}&created_at=gte.${since(10 * 60 * 1000)}`) >= PER_10MIN ||
          await countRows(`ip_hash=eq.${hash}&created_at=gte.${since(24 * 3600 * 1000)}`) >= PER_DAY) {
        return res.status(429).json({ error: '短い時間にたくさん送られています。時間をおいてお試しください' });
      }
      const dailyLimit = Number(process.env.CUSTOMER_DAILY_LIMIT) || 200;
      if (await countRows(`source=eq.customer&created_at=gte.${since(24 * 3600 * 1000)}`) >= dailyLimit) {
        return res.status(429).json({ error: '本日の受付は終了しました。またのご意見をお待ちしています' });
      }

      const { category, summary } = await classify({ content, kind, item });
      await insertVoice({
        content, category, summary, kind, item: item || null, rating,
        source: 'customer', store: code, ip_hash: hash,
      });
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'この操作はできません' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: '送信できませんでした。時間をおいてお試しください' });
  }
}
