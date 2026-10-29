-- 声の種類・お客様用画面・写真のための列を足す（SupabaseのSQL Editorで1回だけ実行）
alter table voices add column if not exists kind text;        -- お客様の声／困りごと／アイデア／ありません／欲しい商品／ご意見・ご要望
alter table voices add column if not exists source text default 'staff';  -- staff（店員）／customer（お客様）
alter table voices add column if not exists item text;        -- 「ありません」「欲しい商品」の商品名・サービス名
alter table voices add column if not exists rating int;       -- お客様の満足度（1〜5）
alter table voices add column if not exists photo_path text;  -- 写真の保存場所（非公開の置き場）
alter table voices add column if not exists store text;       -- 店のコード
alter table voices add column if not exists ip_hash text;     -- いたずら対策（送信元を元に戻せない形にしたもの）

create index if not exists voices_ip_hash_created_at on voices (ip_hash, created_at);
create index if not exists voices_created_at on voices (created_at);
