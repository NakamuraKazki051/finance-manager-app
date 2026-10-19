class SummariesController < ApplicationController
  # 推移を一度に取れる月数の上限(画面は12か月を使う。重い問い合わせを防ぐ)
  MAX_MONTHS = 24

  # GET /api/books/:book_id/summary?month=YYYY-MM
  # 月の収入合計・支出合計・残高と、カテゴリごとの合計。取引の無いカテゴリも 0 円で、カテゴリの並び順どおりに含める。
  # 合計・残高は確定の取引だけで出し、予定の取引(F-13)は plannedIncome / plannedExpense / plannedTotal に別に出す。
  # 件数(count)は予定も含めた件数
  def show
    require_book!(params[:book_id], current_user_id!)
    raise ApiError.bad_request("month を指定してください") if params[:month].blank?
    month = month_value(params[:month])

    # 合計は DB の SUM で出す(画面の合計とAPIの集計が1円もずれないようにする)
    rows = Entry.where(book_id: params[:book_id]).in_month(month)
                .group(:category_id, :confirmed).pluck(:category_id, :confirmed, Arel.sql("SUM(amount)"), Arel.sql("COUNT(*)"))
    totals = Hash.new { |h, k| h[k] = { confirmed: 0, planned: 0, count: 0 } }
    rows.each do |category_id, confirmed, total, count|
      totals[category_id][confirmed ? :confirmed : :planned] += total.to_i
      totals[category_id][:count] += count.to_i
    end

    income = expense = planned_income = planned_expense = count = 0
    categories = Category.where(book_id: params[:book_id]).order(:display_order, :id).map do |category|
      t = totals.fetch(category.id, { confirmed: 0, planned: 0, count: 0 })
      if category.income?
        income += t[:confirmed]
        planned_income += t[:planned]
      else
        expense += t[:confirmed]
        planned_expense += t[:planned]
      end
      count += t[:count]
      { categoryId: category.id, total: t[:confirmed], plannedTotal: t[:planned], count: t[:count] }
    end

    render json: {
      month: month.strftime("%Y-%m"),
      income: income,
      expense: expense,
      balance: income - expense,
      plannedIncome: planned_income,
      plannedExpense: planned_expense,
      count: count,
      categories: categories
    }
  end

  # GET /api/books/:book_id/summary/monthly?from=YYYY-MM&to=YYYY-MM
  # 月ごとの収入合計・支出合計・残高(F-11 の推移グラフ用)。取引の無い月も 0 円で含め、古い月から並べる。
  # 月の集計と同じく、確定の取引だけを数える
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
                .where(book_id: params[:book_id], confirmed: true, transaction_date: from..to.end_of_month)
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
