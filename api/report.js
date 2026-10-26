// 月次レポート：作成と取得（Vercel Functions）
// GET  /api/report?month=2026-10 … その月の最新レポートと、提案（actions）を返す
// POST /api/report  {month:"2026-10"} … その月の声をAIで分析してレポートを作り、提案と一緒に保存する

import { CATEGORIES, guard, supabase, claudeStructured } from './_lib.js';

export const config = { maxDuration: 60 };

// 日本時間で月の始まりと終わり、前月を求める
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
  const prevMonth = `${py}-${pad(pm)}`;
  return { start, end, prevStart, prevMonth };
}

async function fetchVoices(from, to) {
  const q = `voices?select=*&created_at=gte.${encodeURIComponent(from)}&created_at=lt.${encodeURIComponent(to)}&order=created_at.asc&limit=1000`;
  const r = await supabase(q);
  if (!r.ok) throw new Error(`声の取得に失敗しました（${r.status}）`);
  return r.json();
}

// 前月のレポートで出した提案と、その状況（やる／見送り／実施済み）を取る
async function fetchPrevActions(prevMonth) {
  const r = await supabase(`reports?select=id&month=eq.${prevMonth}&order=created_at.desc&limit=1`);
  if (!r.ok) return [];
  const [rep] = await r.json();
  if (!rep) return [];
  const a = await supabase(`actions?select=*&report_id=eq.${rep.id}&order=id.asc`);
  return a.ok ? a.json() : [];
}

function countBy(rows, key) {
  const out = {};
  for (const r of rows) {
    const k = r[key] || '未記入';
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

// 優先度の点数（高いほど先にやる）。効果を重く見て、手軽さ・費用・始めやすさを足す
const COST = { 低: 2, 中: 1, 高: 0 };
const START = { 今週: 2, 今月: 1, 来月以降: 0 };
function score(d) {
  return (Number(d.impact) || 0) * 2 + (Number(d.ease) || 0) + (COST[d.cost] ?? 0) + (START[d.start] ?? 0);
}

const SYSTEM =
  'あなたはスーパーマーケットの店長を支える分析担当です。店員が1か月間に記録したお客様の声と現場の困りごとを読み、' +
  '店長が「次に何を、どの順でやるか」を決められるレポートを作ります。\n' +
  '・似た内容の声を束ねて「テーマ」にし、件数の多い順・影響の大きい順に最大5つ挙げる\n' +
  '・「お断りした」声は、新商品・新サービスの種として別にまとめる\n' +
  '・今月やることは、テーマに対する具体的な行動を3〜5つ。効果（1〜5）、手軽さ（1〜5、5が最も手軽）、費用（低・中・高）、' +
  '始めやすさ（今週・今月・来月以降）を付け、担当の目安、期限、効果の確かめ方を書く\n' +
  '・新商品・新サービスの案は2〜3つ。同じ観点で評価し、大きな投資の前に小さく試す方法を必ず書く\n' +
  '・先月の提案とその状況が与えられた場合は、記録と照らして効果を振り返る（声が減ったか、続けるべきか）\n' +
  '・原因の見立ては断定せず「〜の可能性」と書く。記録にないことを作らない。件数は与えられた記録から数える\n' +
  '・各項目は簡潔に。1つの文は60字以内\n' +
  '結果は save_report ツールで返す。';

const str = { type: 'string' };
const int15 = (desc) => ({ type: 'integer', minimum: 1, maximum: 5, description: desc });
const strList = (desc, max) => ({ type: 'array', description: desc, maxItems: max, items: str });
const evalProps = {
  title: { type: 'string', description: '短い名前' },
  reason: { type: 'string', description: 'なぜやるか（根拠となる声や件数）' },
  impact: int15('効果の大きさ（5が最大）'),
  ease: int15('手軽さ（5が最も手軽）'),
  cost: { type: 'string', enum: ['低', '中', '高'], description: '費用' },
  start: { type: 'string', enum: ['今週', '今月', '来月以降'], description: '始めやすさ' },
  measure: { type: 'string', description: '効果の確かめ方' },
};
const REPORT_TOOL = {
  name: 'save_report',
  description: '月次レポートを保存する',
  input_schema: {
    type: 'object',
    required: ['highlights', 'themes', 'declined', 'actions', 'new_services', 'review', 'next_checks'],
    properties: {
      highlights: strList('今月の要点（各40字以内）', 3),
      themes: {
        type: 'array', maxItems: 5, description: '注目テーマ（件数の多い順・影響の大きい順）',
        items: {
          type: 'object', required: ['title', 'count', 'examples', 'cause'],
          properties: {
            title: { type: 'string', description: 'テーマ名' },
            count: { type: 'integer', description: '該当する記録の件数' },
            examples: strList('代表的な声（原文から）', 3),
            cause: { type: 'string', description: '原因の見立て' },
          },
        },
      },
      declined: {
        type: 'array', maxItems: 8, description: 'お断りした要望',
        items: {
          type: 'object', required: ['request', 'count'],
          properties: {
            request: { type: 'string', description: 'お断りした要望' },
            count: { type: 'integer', description: '件数' },
          },
        },
      },
      actions: {
        type: 'array', maxItems: 5, description: '今月やること（改善）',
        items: {
          type: 'object', required: ['title', 'reason', 'impact', 'ease', 'cost', 'start', 'owner', 'due', 'measure'],
          properties: {
            ...evalProps,
            owner: { type: 'string', description: '担当の目安（例：惣菜部門リーダー）' },
            due: { type: 'string', description: '期限の目安（例：11月第2週まで）' },
          },
        },
      },
      new_services: {
        type: 'array', maxItems: 3, description: '新商品・新サービスの案',
        items: {
          type: 'object', required: ['title', 'reason', 'impact', 'ease', 'cost', 'start', 'trial', 'measure'],
          properties: { ...evalProps, trial: { type: 'string', description: 'まず小さく試す方法' } },
        },
      },
      review: {
        type: 'array', maxItems: 8, description: '先月の提案の振り返り。先月の提案がなければ空',
        items: {
          type: 'object', required: ['title', 'status', 'comment'],
          properties: {
            title: { type: 'string', description: '先月の提案名' },
            status: { type: 'string', description: '先月の提案の状況' },
            comment: { type: 'string', description: '今月の記録から見た効果と、続けるべきか' },
          },
        },
      },
      next_checks: strList('来月確かめること', 5),
    },
  },
};

async function insertActions(reportId, month, ai) {
  const rows = [
    ...(ai.actions || []).map((d) => ({ kind: 'action', d })),
    ...(ai.new_services || []).map((d) => ({ kind: 'service', d })),
  ].map(({ kind, d }) => ({ report_id: reportId, month, kind, title: d.title, data: { ...d, score: score(d) } }));
  if (!rows.length) return [];
  const r = await supabase('actions', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(rows),
  });
  if (!r.ok) {
    if (r.status === 404) throw new Error('Supabaseに「actions」の表がまだありません。追加の文を実行してください');
    throw new Error(`提案の保存に失敗しました（${r.status}）`);
  }
  return r.json();
}

async function fetchActions(reportId) {
  const r = await supabase(`actions?select=*&report_id=eq.${reportId}&order=id.asc`);
  return r.ok ? r.json() : [];
}

export default async function handler(req, res) {
  if (guard(req, res)) return;

  try {
    const month = String((req.method === 'GET' ? req.query.month : req.body && req.body.month) || '');
    if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: '月を選んでください' });

    if (req.method === 'GET') {
      const r = await supabase(`reports?select=*&month=eq.${month}&order=created_at.desc&limit=1`);
      if (!r.ok) throw new Error(`レポートの取得に失敗しました（${r.status}）`);
      const [row] = await r.json();
      if (!row) return res.status(200).json(null);
      return res.status(200).json({ ...row, actions: await fetchActions(row.id) });
    }

    if (req.method === 'POST') {
      const { start, end, prevStart, prevMonth } = monthRange(month);
      const rows = await fetchVoices(start, end);
      if (!rows.length) return res.status(400).json({ error: 'この月の記録がありません' });
      const prevRows = await fetchVoices(prevStart, start);
      const prevActions = await fetchPrevActions(prevMonth);

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
      const prevText = prevActions.length
        ? `\n\n【先月（${prevMonth}）の提案と状況】\n` +
          prevActions.map((a) => `・${a.title}（${a.kind === 'service' ? '新サービス案' : '改善'}）：${a.status}`).join('\n')
        : '';

      const ai = await claudeStructured({
        model: 'claude-sonnet-5-5',
        maxTokens: 8000,
        system: SYSTEM,
        tool: REPORT_TOOL,
        content: `対象月：${month}\n記録件数：${rows.length}件\n\n${lines.join('\n')}${prevText}`,
      });

      const content = { stats, ai, categories: CATEGORIES, version: 2 };
      const r = await supabase('reports', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ month, content }),
      });
      if (!r.ok) throw new Error(`レポートの保存に失敗しました（${r.status}）`);
      const [row] = await r.json();
      const actions = await insertActions(row.id, month, ai);
      return res.status(200).json({ ...row, actions });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'この操作はできません' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
