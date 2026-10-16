# 1件のお金の出入り(API では transaction と呼ぶ)。
# モデル名を Transaction にすると ActiveRecord の transaction メソッドと紛らわしいので Entry にしている。
# 金額は円の整数(小数の誤差を避けるため)で、符号は持たない。収入か支出かは所属するカテゴリの種別で決まる
class Entry < ApplicationRecord
  MAX_AMOUNT = 99_999_999

  belongs_to :book
  belongs_to :category

  attribute :tags, :json, default: -> { [] }

  before_create { self.created_at ||= Time.current }

  scope :in_month, ->(month) { where(transaction_date: month.beginning_of_month..month.end_of_month) }

  def as_api_json
    {
      id: id,
      bookId: book_id,
      categoryId: category_id,
      amount: amount,
      date: transaction_date.iso8601,
      memo: memo,
      tags: tags || [],
      createdAt: created_at&.utc&.iso8601(6)
    }
  end
end
