# ID は推測されにくい UUID の文字列にする(連番だと他人のデータのIDを当てやすい)
class CreateFinanceTables < ActiveRecord::Migration[8.1]
  def change
    create_table :users, id: { type: :string, limit: 36 } do |t|
      t.string :email, null: false, limit: 255
      t.string :password_digest, null: false
      t.datetime :created_at, null: false
    end
    add_index :users, :email, unique: true

    create_table :books, id: { type: :string, limit: 36 } do |t|
      t.string :user_id, null: false, limit: 36
      t.string :name, null: false, limit: 30
      t.datetime :created_at, null: false
    end
    add_index :books, [:user_id, :created_at]

    create_table :categories, id: { type: :string, limit: 36 } do |t|
      t.string :book_id, null: false, limit: 36
      t.string :name, null: false, limit: 30
      # INCOME(収入)/ EXPENSE(支出)。Rails では type 列が単一テーブル継承に使われるので kind という名前にする
      t.string :kind, null: false, limit: 10
      t.integer :display_order, null: false, default: 0
    end
    add_index :categories, [:book_id, :display_order]

    # 取引。金額は円の整数で、符号は持たない(収入か支出かはカテゴリの kind で決まる)
    create_table :entries, id: { type: :string, limit: 36 } do |t|
      t.string :book_id, null: false, limit: 36
      t.string :category_id, null: false, limit: 36
      t.bigint :amount, null: false
      t.date :transaction_date, null: false
      t.string :memo, limit: 100
      t.json :tags, null: false
      t.datetime :created_at, null: false
    end
    # 月ごとの一覧・集計は「家計簿 + 日付の範囲」で引くので、この順の複合インデックスを張る
    add_index :entries, [:book_id, :transaction_date]
    add_index :entries, :category_id
  end
end
