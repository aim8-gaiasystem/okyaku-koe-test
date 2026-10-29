# お客様の声メモ（テスト）

お客様の声や現場の困りごとを入力すると、AI（Claude）が分類・要約してSupabaseに保存し、一覧に表示します。

- 画面と裏側の処理：Vercel（`index.html` と `api/voices.js`）
- データの保存：Supabase（`voices` テーブル）
- 分類と要約：Claude（Anthropic API）

## Vercelに設定する環境変数

| 名前 | 中身 |
| --- | --- |
| `ANTHROPIC_API_KEY` | AnthropicのAPIキー |
| `SUPABASE_URL` | SupabaseのProject URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabaseのservice_roleキー（秘密。画面側には出さない） |
| `APP_PASSCODE` | 入力用の合言葉（店舗スタッフ用）。記録と、今月の件数だけが使える |
| `ADMIN_PASSCODE` | 管理者用の合言葉（本社用）。`/admin.html` で記録の一覧・月次レポート・提案の操作ができる |
| `STORES` | 任意。お客様用画面の店。例 `honten:本店,ekimae:駅前店`。未設定なら `main:本店` |
| `CUSTOMER_DAILY_LIMIT` | 任意。お客様用画面で1日に受け付ける上限（既定200件） |

## 画面

- `/` … 店員さんの入力画面（声の種類、音声入力、「ありません」、写真）
- `/koe.html?s=main` … お客様用の画面（合言葉なし。アプリやQRからこのリンクを開く。店ごとに `s=` を変える）
- `/admin.html` … 管理者画面（集まった声の一覧と絞り込み、月次レポート）

写真はSupabase Storageの非公開の置き場 `voice-photos` に保存されます（初回に自動で作成）。

## Supabaseの表

追加の列は `sql/` の文を番号順に実行します（最新は `04_kinds_photos_customer.sql`）。

```sql
create table voices (
  id bigint generated always as identity primary key,
  created_at timestamptz default now(),
  content text not null,
  category text,
  summary text
);
alter table voices enable row level security;
```

行レベルセキュリティを有効にし、ポリシーを作らないことで、画面から直接は読み書きできず、Vercelの裏側（service_roleキー）からだけ操作できます。
