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
| `APP_PASSCODE`（任意） | 合言葉。設定すると、知っている人だけが使える |

## Supabaseの表

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
