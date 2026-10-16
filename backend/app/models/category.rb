# 収支のカテゴリ(給与・食費など)。画面ではカンバンの1列になる
class Category < ApplicationRecord
  INCOME = "INCOME".freeze
  EXPENSE = "EXPENSE".freeze
  KINDS = [INCOME, EXPENSE].freeze

  belongs_to :book
  has_many :entries, dependent: nil

  def income?
    kind == INCOME
  end

  # API では種別を type という名前で返す(Rails では type 列が特別扱いなので、DB の列名は kind)
  def as_api_json
    { id: id, bookId: book_id, name: name, type: kind, displayOrder: display_order }
  end
end
