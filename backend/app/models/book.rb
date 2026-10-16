# 家計簿。カテゴリと取引をまとめる単位で、ユーザーは用途ごとに複数持てる(生活費・副業など)
class Book < ApplicationRecord
  DEFAULT_NAME = "家計簿".freeze

  # 家計簿を作ったときに用意する初期カテゴリ。収入を左、支出を右に並べる
  DEFAULT_CATEGORIES = [
    ["給与", Category::INCOME],
    ["食費", Category::EXPENSE],
    ["日用品", Category::EXPENSE],
    ["交通費", Category::EXPENSE],
    ["住居・光熱費", Category::EXPENSE],
    ["その他", Category::EXPENSE]
  ].freeze

  belongs_to :user
  # カテゴリ・取引の削除はコントローラーで明示的に行う(1件ずつのコールバックを走らせない)
  has_many :categories, -> { order(:display_order) }, dependent: nil
  has_many :entries, dependent: nil

  def create_default_categories!
    DEFAULT_CATEGORIES.each_with_index do |(name, kind), index|
      categories.create!(name: name, kind: kind, display_order: index)
    end
  end

  def as_api_json
    { id: id, name: name }
  end
end
