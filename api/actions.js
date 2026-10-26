// 提案の状況を更新する（Vercel Functions）
// PATCH /api/actions  {id: 1, status: "やる"}

import { guard, supabase } from './_lib.js';

const STATUSES = ['未決定', 'やる', '見送り', '実施済み'];

export default async function handler(req, res) {
  if (guard(req, res, 'admin')) return;

  try {
    if (req.method !== 'PATCH') {
      res.setHeader('Allow', 'PATCH');
      return res.status(405).json({ error: 'この操作はできません' });
    }
    const id = Number(req.body && req.body.id);
    const status = String((req.body && req.body.status) || '');
    if (!id || !STATUSES.includes(status)) return res.status(400).json({ error: '状況の指定が正しくありません' });

    const r = await supabase(`actions?id=eq.${id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ status }),
    });
    if (!r.ok) throw new Error(`状況の更新に失敗しました（${r.status}）`);
    const [row] = await r.json();
    return res.status(200).json(row);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
