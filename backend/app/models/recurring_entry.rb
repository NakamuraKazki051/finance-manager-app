# 固定費の繰り返し(F-12)。毎月 day_of_month 日に、同じ金額・カテゴリ・メモ・タグの取引を「予定」として作る。
# 作った取引は引き落としなどを確認してから、画面で「確定」にしてもらう
class RecurringEntry < ApplicationRecord
  belongs_to :book
  belongs_to :category

  attribute :tags, :json, default: -> { [] }

  before_create { self.created_at ||= Time.current }

  # through の月(その月の1日)まで、まだ作っていない月の取引を作る。作った件数を返す。
  # 同時に呼ばれても二重に作らないよう、固定費の行をロックしてから last_generated_month を見る
  def self.generate_for_book!(book_id, through:)
    created = 0
    transaction do
      where(book_id: book_id).order(:id).lock.each do |rule|
        created += rule.generate_through!(through)
      end
    end
    created
  end

  def generate_through!(through)
    month = last_generated_month ? last_generated_month.next_month : start_month
    created = 0
    while month <= through
      Entry.create!(book_id: book_id, category_id: category_id, amount: amount, transaction_date: date_in(month),
                    memo: memo, tags: tags, confirmed: false, recurring_entry_id: id)
      self.last_generated_month = month
      month = month.next_month
      created += 1
    end
    save! if created.positive?
    created
  end

  # その月の day_of_month 日。月に無い日は月末(2月31日 → 2月28日、うるう年は29日)
  def date_in(month)
    month.change(day: [day_of_month, month.end_of_month.day].min)
  end

  def as_api_json
    {
      id: id,
      bookId: book_id,
      categoryId: category_id,
      amount: amount,
      day: day_of_month,
      memo: memo,
      tags: tags || [],
      startMonth: start_month.strftime("%Y-%m"),
      lastGeneratedMonth: last_generated_month&.strftime("%Y-%m"),
      createdAt: created_at&.utc&.iso8601(6)
    }
  end
end
