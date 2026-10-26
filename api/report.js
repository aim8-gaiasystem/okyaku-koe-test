// 月次レポート：作成と取得（Vercel Functions）
// GET  /api/report?month=2026-10 … その月の最新レポートを返す
// POST /api/report  {month:"2026-10"} … その月の声をAIで分析してレポートを作り、保存する

import { CATEGORIES, guard, supabase, claudeStructured } from './_lib.js';

export const config = { maxDuration: 60 };

// 日本時間で月の始まりと終わりを求める
function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  const pad = (n) => String(n).padStart(2, '0');
  const start = `${y}-${pad(m)}-01T00:00:00+09:00`;
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const end = `${ny}-${pad(nm)}-01T00:00:00+09:00`;
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  const prevStart = `${py}-${pad(pm)}-01T00:00:00+09:00`;
  return { start, end, prevStart };
}

async function fetchVoices(from, to) {
  const q = `voices?select=*&created_at=gte.${encodeURIComponent(from)}&created_at=lt.${encodeURIComponent(to)}&order=created_at.asc&limit=1000`;
  const r = await supabase(q);
  if (!r.ok) throw new Error(`声の取得に失敗しました（${r.status}）`);
  return r.json();
}

function countBy(rows, key) {
  const out = {};
  for (const r of rows) {
    const k = r[key] || '未記入';
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

const SYSTEM =
  'あなたはスーパーマーケットの店長を支える分析担当です。店員が1か月間に記録したお客様の声と現場の困りごとを読み、' +
  '店長が次の行動を決められるレポートを作ります。\n' +
  '・似た内容の声を束ねて「テーマ」にし、件数の多い順・影響の大きい順に最大5つ挙げる\n' +
  '・「お断りした」声は、新商品・新サービスの種として別にまとめる\n' +
  '・原因の見立ては断定せず「〜の可能性」と書く\n' +
  '・提案は、お金や人手をあまりかけずに今月すぐできることを優先する\n' +
  '・記録にないことを作らない。件数は与えられた記録から数える\n' +
  '・各項目は簡潔に。1つの文は60字以内\n' +
  '結果は save_report ツールで返す。';

const str = { type: 'string' };
const strList = (desc, max) => ({ type: 'array', description: desc, maxItems: max, items: str });
const REPORT_TOOL = {
  name: 'save_report',
  description: '月次レポートを保存する',
  input_schema: {
    type: 'object',
    required: ['highlights', 'themes', 'declined', 'quick_wins', 'new_ideas', 'next_checks'],
    properties: {
      highlights: strList('今月の要点（各40字以内）', 3),
      themes: {
        type: 'array', maxItems: 5, description: '注目テーマ（件数の多い順・影響の大きい順）',
        items: {
          type: 'object', required: ['title', 'count', 'examples', 'cause', 'action'],
          properties: {
            title: { type: 'string', description: 'テーマ名' },
            count: { type: 'integer', description: '該当する記録の件数' },
            examples: strList('代表的な声（原文から）', 3),
            cause: { type: 'string', description: '原因の見立て' },
            action: { type: 'string', description: '打ち手' },
          },
        },
      },
      declined: {
        type: 'array', maxItems: 8, description: 'お断りした要望',
        items: {
          type: 'object', required: ['request', 'count', 'idea'],
          properties: {
            request: { type: 'string', description: 'お断りした要望' },
            count: { type: 'integer', description: '件数' },
            idea: { type: 'string', description: '新商品・サービスの案' },
          },
        },
      },
      quick_wins: strList('すぐできる改善', 5),
      new_ideas: strList('検討したい新商品・サービス', 5),
      next_checks: strList('来月確かめること', 5),
    },
  },
};

export default async function handler(req, res) {
  if (guard(req, res)) return;

  try {
    const month = String((req.method === 'GET' ? req.query.month : req.body && req.body.month) || '');
    if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: '月を選んでください' });

    if (req.method === 'GET') {
      const r = await supabase(`reports?select=*&month=eq.${month}&order=created_at.desc&limit=1`);
      if (!r.ok) {
        if (r.status === 404) throw new Error('Supabaseに「reports」の表がまだありません。追加の文を実行してください');
        throw new Error(`レポートの取得に失敗しました（${r.status}）`);
      }
      const [row] = await r.json();
      return res.status(200).json(row || null);
    }

    if (req.method === 'POST') {
      const { start, end, prevStart } = monthRange(month);
      const rows = await fetchVoices(start, end);
      if (!rows.length) return res.status(400).json({ error: 'この月の記録がありません' });
      const prevRows = await fetchVoices(prevStart, start);

      const stats = {
        total: rows.length,
        prevTotal: prevRows.length,
        byCategory: countBy(rows, 'category'),
        prevByCategory: countBy(prevRows, 'category'),
        bySection: countBy(rows, 'section'),
        byOutcome: countBy(rows, 'outcome'),
      };

      const lines = rows.map((r, i) =>
        `${i + 1}. [分類:${r.category || '未分類'}][売場:${r.section || '未記入'}][対応:${r.outcome || '未記入'}] ${r.content}`
      );
      const ai = await claudeStructured({
        model: 'claude-sonnet-5-5',
        maxTokens: 8000,
        system: SYSTEM,
        tool: REPORT_TOOL,
        content: `対象月：${month}\n記録件数：${rows.length}件\n\n${lines.join('\n')}`,
      });

      const content = { stats, ai, categories: CATEGORIES };
      const r = await supabase('reports', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ month, content }),
      });
      if (!r.ok) {
        if (r.status === 404) throw new Error('Supabaseに「reports」の表がまだありません。追加の文を実行してください');
        throw new Error(`レポートの保存に失敗しました（${r.status}）`);
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
