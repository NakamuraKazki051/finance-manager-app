# 取引の「予定/確定」(F-13)。予定の取引は月の収入・支出・残高に入れず、別に表示する。既存の取引はすべて確定
class AddConfirmedToEntries < ActiveRecord::Migration[8.1]
  def change
    add_column :entries, :confirmed, :boolean, null: false, default: true
  end
end
