-- 月次レポートで出した提案（今月やること・新サービス案）と、その状況を保存する表
create table if not exists actions (
  id bigint generated always as identity primary key,
  created_at timestamptz default now(),
  report_id bigint references reports(id) on delete cascade,
  month text not null,
  kind text not null,          -- action（改善）または service（新商品・新サービス）
  title text not null,
  data jsonb not null,         -- 理由・効果・手軽さ・費用・始めやすさ・担当・期限・確かめ方・点数など
  status text not null default '未決定'  -- 未決定／やる／見送り／実施済み
);
alter table actions enable row level security;
