class BookImportsController < ApplicationController
  # PUT /api/books/:book_id/import
  #   {categories: [{id, name, type, budget?}],
  #    transactions: [{categoryId, amount, date, memo, tags, confirmed?, recurringId?}],
  #    recurring?: [{id, categoryId, amount, day, memo, tags, startMonth, lastGeneratedMonth?}]}
  # 家計簿のカテゴリ・取引・固定費をバックアップの内容で置き換える。1件でも不正なデータがあれば何も変更しない。
  # confirmed の無い古いバックアップの取引は確定として取り込む。固定費の無い古いバックアップでは固定費が空になる
  def update
    book_id = params[:book_id]
    require_book!(book_id, current_user_id!)

    categories = params[:categories]
    raise ApiError.bad_request("カテゴリが1つもありません") unless categories.is_a?(Array) && categories.any?
    transactions = params[:transactions] || []
    raise ApiError.bad_request(MALFORMED_MESSAGE) unless transactions.is_a?(Array)
    recurring = params[:recurring] || []
    raise ApiError.bad_request(MALFORMED_MESSAGE) unless recurring.is_a?(Array)

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
    current_month = Time.zone.today.beginning_of_month
    rule_rows = recurring.map do |r|
      raise ApiError.bad_request(MALFORMED_MESSAGE) unless r.is_a?(ActionController::Parameters)
      unless known_ids.include?(r[:categoryId])
        raise ApiError.bad_request("固定費が参照するカテゴリが見つかりません: #{r[:categoryId]}")
      end
      start_month = month_value(r[:startMonth])
      # 作り済みの月が無いバックアップは、今月までは作り済みとみなす(取り込んだ取引と二重にしない)
      last_generated = if r[:lastGeneratedMonth].present?
                         month_value(r[:lastGeneratedMonth])
                       elsif start_month <= current_month
                         current_month
                       end
      {
        old_id: r[:id]&.to_s,
        old_category_id: r[:categoryId],
        amount: amount_value(r[:amount]),
        day_of_month: day_value(r[:day]),
        memo: memo_value(r[:memo]),
        tags: tags_value(r[:tags]),
        start_month: start_month,
        last_generated_month: last_generated
      }
    end
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
        confirmed: confirmed_value(t[:confirmed], default: true),
        old_recurring_id: t[:recurringId]
      }
    end

    Book.transaction do
      Entry.where(book_id: book_id).delete_all
      RecurringEntry.where(book_id: book_id).delete_all
      Category.where(book_id: book_id).delete_all
      id_map = {}
      category_rows.each_with_index do |row, index|
        category = Category.create!(book_id: book_id, name: row[:name], kind: row[:kind], budget: row[:budget],
                                    display_order: index)
        id_map[row[:old_id]] = category.id if row[:old_id]
      end
      rule_id_map = {}
      rule_rows.each do |row|
        rule = RecurringEntry.create!(row.except(:old_id, :old_category_id)
                                         .merge(book_id: book_id, category_id: id_map.fetch(row[:old_category_id])))
        rule_id_map[row[:old_id]] = rule.id if row[:old_id]
      end
      entry_rows.each do |row|
        Entry.create!(book_id: book_id, category_id: id_map.fetch(row[:old_category_id]),
                      amount: row[:amount], transaction_date: row[:transaction_date], memo: row[:memo], tags: row[:tags],
                      confirmed: row[:confirmed], recurring_entry_id: rule_id_map[row[:old_recurring_id]])
      end
    end
    head :no_content
  end
end
