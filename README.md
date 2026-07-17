# SQL Emulator for micro:bit

micro:bit上で動く、軽量なSQL風データベース・エミュレータのMakeCode拡張機能です。
テーブルの作成・挿入・検索・更新・削除といったSQLのデータ操作をすべてブロック（またはSQL風のテキスト）で実行でき、
すべての操作は内蔵の **データロガー (Data Logger)** に自動的に記録されるので、
micro:bitをPCにつなげばCSVファイルとして操作履歴やスナップショットを取り出せます。

## できること (実装済みのSQL操作)

- `CREATE TABLE` ... テーブルの作成
- `DROP TABLE` ... テーブルの削除
- `INSERT` ... 行の追加
- `SELECT` (`WHERE`, `ORDER BY`, `LIMIT` 相当のブロックあり) ... 検索
- `UPDATE ... SET ... WHERE ...` ... 更新
- `DELETE ... WHERE ...` ... 削除
- 集計関数: `COUNT` / `SUM` / `AVERAGE` / `MIN` / `MAX`
- テーブル情報: 行数の取得、テーブル存在チェック、全削除

比較演算子は `=` `!=` `<` `>` `<=` `>=` に対応しています（WHERE条件は1つだけ、AND/ORの連結は未対応です）。

## データの保存方法

データそのものはmicro:bitのRAM上の配列に保持されますが、以下のタイミングで**データロガーに書き込み**を行います。

- テーブルの作成・削除
- 行の挿入・更新・削除
- `save snapshot of table ... to data logger` ブロックを呼んだとき（テーブルの中身を丸ごとログに書き出す）

これにより、電源を切る前にmicro:bitをUSBでPCに接続すれば、`MY_DATA.HTM` から
操作履歴やスナップショットをCSV/表形式で確認できます。

## ブロックの例

```blocks
sql.createTable("pets", "name,kind,age")
sql.insert("pets", "Rex,dog,3")
sql.insert("pets", "Mimi,cat,2")

let n = sql.select("pets", "kind", sql.CompareOp.Equal, "dog")
basic.showNumber(n)
```

## SQLテキストで実行する例

```blocks
sql.query("CREATE TABLE pets (name, kind, age)")
sql.query("INSERT INTO pets VALUES (Rex, dog, 3)")
sql.query("SELECT * FROM pets WHERE kind = dog")
basic.showString(sql.resultAsText())
sql.query("UPDATE pets SET age = 4 WHERE name = Rex")
sql.query("DELETE FROM pets WHERE kind = cat")
```

## 制限事項

- WHERE句は1条件のみ（AND / OR は使えません）
- サブクエリ、JOIN、GROUP BYには対応していません
- 数値かどうかは値の見た目から自動判定します（数字のみなら数値として比較）

## License

MIT

## Supported targets

* for PXT/microbit
<script src="https://makecode.com/gh-pages-embed.js"></script><script>makeCodeRender("{{ site.makecode.home_url }}", "{{ site.github.owner }}/{{ site.github.repo }}");</script>
