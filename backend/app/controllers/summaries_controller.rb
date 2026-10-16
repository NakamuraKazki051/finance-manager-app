class SummariesController < ApplicationController
  # GET /api/books/:book_id/summary?month=YYYY-MM
  # 月の収入合計・支出合計・残高と、カテゴリごとの合計。取引の無いカテゴリも 0 円で、カテゴリの並び順どおりに含める
  def show
    require_book!(params[:book_id], current_user_id!)
    raise ApiError.bad_request("month を指定してください") if params[:month].blank?
    month = month_value(params[:month])

    # 合計は DB の SUM で出す(画面の合計とAPIの集計が1円もずれないようにする)
    rows = Entry.where(book_id: params[:book_id]).in_month(month)
                .group(:category_id).pluck(:category_id, Arel.sql("SUM(amount)"), Arel.sql("COUNT(*)"))
    totals = rows.to_h { |category_id, total, count| [category_id, [total.to_i, count.to_i]] }

    income = expense = count = 0
    categories = Category.where(book_id: params[:book_id]).order(:display_order, :id).map do |category|
      total, n = totals.fetch(category.id, [0, 0])
      category.income? ? income += total : expense += total
      count += n
      { categoryId: category.id, total: total, count: n }
    end

    render json: {
      month: month.strftime("%Y-%m"),
      income: income,
      expense: expense,
      balance: income - expense,
      count: count,
      categories: categories
    }
  end
end
