class SummariesController < ApplicationController
  # 推移を一度に取れる月数の上限(画面は12か月を使う。重い問い合わせを防ぐ)
  MAX_MONTHS = 24

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

  # GET /api/books/:book_id/summary/monthly?from=YYYY-MM&to=YYYY-MM
  # 月ごとの収入合計・支出合計・残高(F-11 の推移グラフ用)。取引の無い月も 0 円で含め、古い月から並べる
  def monthly
    require_book!(params[:book_id], current_user_id!)
    raise ApiError.bad_request("from と to を指定してください") if params[:from].blank? || params[:to].blank?
    from = month_value(params[:from])
    to = month_value(params[:to])
    raise ApiError.bad_request("from は to 以前の月を指定してください") if from > to
    months = (to.year * 12 + to.month) - (from.year * 12 + from.month) + 1
    raise ApiError.bad_request("期間は#{MAX_MONTHS}か月以内で指定してください") if months > MAX_MONTHS

    # 月 × 種別ごとに DB で合計する。種別は取引ではなくカテゴリが持つので結合する
    rows = Entry.joins(:category)
                .where(book_id: params[:book_id], transaction_date: from..to.end_of_month)
                .group(Arel.sql("DATE_FORMAT(entries.transaction_date, '%Y-%m')"), "categories.kind")
                .pluck(Arel.sql("DATE_FORMAT(entries.transaction_date, '%Y-%m')"), "categories.kind", Arel.sql("SUM(entries.amount)"))
    totals = Hash.new(0)
    rows.each { |month, kind, total| totals[[month, kind]] = total.to_i }

    render json: {
      from: from.strftime("%Y-%m"),
      to: to.strftime("%Y-%m"),
      months: Array.new(months) do |i|
        key = (from >> i).strftime("%Y-%m")
        income = totals[[key, Category::INCOME]]
        expense = totals[[key, Category::EXPENSE]]
        { month: key, income: income, expense: expense, balance: income - expense }
      end
    }
  end
end
