# 支出カテゴリの月間予算(円)。毎月同じ額を使う。未設定は NULL
class AddBudgetToCategories < ActiveRecord::Migration[8.1]
  def change
    add_column :categories, :budget, :bigint
  end
end
