# 固定費の繰り返し(F-12)。家賃・サブスクなどを「毎月…日」で登録し、月が変わると予定の取引を作る
class CreateRecurringEntries < ActiveRecord::Migration[8.1]
  def change
    create_table :recurring_entries, id: { type: :string, limit: 36 } do |t|
      t.string :book_id, null: false, limit: 36
      t.string :category_id, null: false, limit: 36
      t.bigint :amount, null: false
      # 毎月の日付(1〜31)。その月に無い日(2月30日など)は月末に寄せる
      t.integer :day_of_month, null: false
      t.string :memo, limit: 100
      t.json :tags, null: false
      # 最初に取引を作る月(その月の1日)
      t.date :start_month, null: false
      # 取引を作り終えた最後の月(その月の1日)。まだ1つも作っていなければ NULL
      t.date :last_generated_month
      t.datetime :created_at, null: false
    end
    add_index :recurring_entries, :book_id
    add_index :recurring_entries, :category_id

    # 固定費から作った取引の印。固定費を消しても取引は残し、ここを NULL にする
    add_column :entries, :recurring_entry_id, :string, limit: 36
  end
end
