class BookImportsController < ApplicationController
  # PUT /api/books/:book_id/import  {categories: [{id, name, type, budget?}], transactions: [{categoryId, amount, date, memo, tags, confirmed?}]}
  # 家計簿のカテゴリ・取引をバックアップの内容で置き換える。1件でも不正なデータがあれば何も変更しない。
  # confirmed の無い古いバックアップの取引は確定として取り込む
  def update
    book_id = params[:book_id]
    require_book!(book_id, current_user_id!)

    categories = params[:categories]
    raise ApiError.bad_request("カテゴリが1つもありません") unless categories.is_a?(Array) && categories.any?
    transactions = params[:transactions] || []
    raise ApiError.bad_request(MALFORMED_MESSAGE) unless transactions.is_a?(Array)

    # 消す前に全件を検証する
    category_rows = categories.map do |c|
      raise ApiError.bad_request(MALFORMED_MESSAGE) unless c.is_a?(ActionController::Parameters)
      {
        old_id: c[:id]&.to_s,
        name: required_string(c[:name], max: 30, blank_message: "カテゴリ名を入力してください",
                                        too_long_message: "カテゴリ名は30文字以内で入力してください").strip,
        kind: category_kind(c[:type]),
        budget: budget_value(c[:budget])
      }
    end
    known_ids = category_rows.filter_map { |c| c[:old_id] }
    entry_rows = transactions.map do |t|
      raise ApiError.bad_request(MALFORMED_MESSAGE) unless t.is_a?(ActionController::Parameters)
      unless known_ids.include?(t[:categoryId])
        raise ApiError.bad_request("取引が参照するカテゴリが見つかりません: #{t[:categoryId]}")
      end
      {
        old_category_id: t[:categoryId],
        amount: amount_value(t[:amount]),
        transaction_date: date_value(t[:date]),
        memo: memo_value(t[:memo]),
        tags: tags_value(t[:tags]),
        confirmed: confirmed_value(t[:confirmed], default: true)
      }
    end

    Book.transaction do
      Entry.where(book_id: book_id).delete_all
      Category.where(book_id: book_id).delete_all
      id_map = {}
      category_rows.each_with_index do |row, index|
        category = Category.create!(book_id: book_id, name: row[:name], kind: row[:kind], budget: row[:budget],
                                    display_order: index)
        id_map[row[:old_id]] = category.id if row[:old_id]
      end
      entry_rows.each do |row|
        Entry.create!(book_id: book_id, category_id: id_map.fetch(row[:old_category_id]),
                      amount: row[:amount], transaction_date: row[:transaction_date], memo: row[:memo], tags: row[:tags],
                      confirmed: row[:confirmed])
      end
    end
    head :no_content
  end
end
