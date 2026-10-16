# 取引(Entry モデル)の API
class TransactionsController < ApplicationController
  # GET /api/books/:book_id/transactions?month=&tag=&q=&minAmount=&maxAmount=&sort=date|amount
  # month(YYYY-MM)を指定するとその月だけを返す。並び順は日付の新しい順(既定)か金額の大きい順
  def index
    require_book!(params[:book_id], current_user_id!)
    sort = params[:sort].presence || "date"
    raise ApiError.bad_request("並び順は date か amount で指定してください: #{sort}") unless %w[date amount].include?(sort)
    min_amount = integer_query(:minAmount)
    max_amount = integer_query(:maxAmount)

    scope = Entry.where(book_id: params[:book_id])
    scope = scope.in_month(month_value(params[:month])) if params[:month].present?
    scope = scope.where(amount: min_amount..) if min_amount
    scope = scope.where(amount: ..max_amount) if max_amount
    if params[:q].present?
      scope = scope.where("memo LIKE ?", "%#{Entry.sanitize_sql_like(params[:q])}%")
    end
    # 同じ日付・金額どうしは登録の新しい順にして、表示順を安定させる
    scope = sort == "amount" ? scope.order(amount: :desc, transaction_date: :desc, created_at: :desc)
                             : scope.order(transaction_date: :desc, created_at: :desc)
    entries = scope.to_a
    entries = entries.select { |e| e.tags.include?(params[:tag]) } if params[:tag].present?
    render json: entries.map(&:as_api_json)
  end

  # GET /api/transactions/:id
  def show
    render json: find_owned_entry!.as_api_json
  end

  # POST /api/books/:book_id/transactions  {amount, date, categoryId, memo?, tags?}
  def create
    require_book!(params[:book_id], current_user_id!)
    attrs = entry_attributes(params[:book_id])
    entry = Entry.create!(attrs.merge(book_id: params[:book_id]))
    render json: entry.as_api_json, status: :created
  end

  # PUT /api/transactions/:id
  def update
    entry = find_owned_entry!
    entry.update!(entry_attributes(entry.book_id))
    render json: entry.as_api_json
  end

  # PATCH /api/transactions/:id/move  {categoryId}。ドラッグ&ドロップで別のカテゴリへ付け替える
  def move
    entry = find_owned_entry!
    entry.update!(category_id: category_in_book!(params[:categoryId], entry.book_id).id)
    render json: entry.as_api_json
  end

  # DELETE /api/transactions/:id
  def destroy
    find_owned_entry!.delete
    head :no_content
  end

  # POST /api/books/:book_id/transactions/bulk-delete  {transactionIds}
  def bulk_delete
    require_book!(params[:book_id], current_user_id!)
    ids = params[:transactionIds]
    raise ApiError.bad_request("削除する取引を指定してください") unless ids.is_a?(Array) && ids.any? && ids.all?(String)

    ids = ids.uniq
    targets = Entry.where(id: ids).to_a
    # 1件でも見つからない・別の家計簿の取引が混ざっていれば何も削除せずに失敗させる
    if targets.size != ids.size || targets.any? { |e| e.book_id != params[:book_id] }
      raise ApiError.not_found("削除対象に存在しない取引が含まれています")
    end
    Entry.where(id: ids).delete_all
    head :no_content
  end

  private

  def entry_attributes(book_id)
    {
      amount: amount_value(params[:amount]),
      transaction_date: date_value(params[:date]),
      category_id: category_in_book!(params[:categoryId], book_id).id,
      memo: memo_value(params[:memo]),
      tags: tags_value(params[:tags])
    }
  end

  def find_owned_entry!
    user_id = current_user_id!
    entry = Entry.find_by(id: params[:id]) or raise ApiError.not_found("取引が見つかりません: #{params[:id]}")
    require_book!(entry.book_id, user_id)
    entry
  end

  def category_in_book!(category_id, book_id)
    raise ApiError.bad_request("カテゴリを指定してください") unless category_id.is_a?(String) && category_id.present?
    category = Category.find_by(id: category_id) or raise ApiError.not_found("カテゴリが見つかりません: #{category_id}")
    raise ApiError.bad_request("指定したカテゴリはこの家計簿に属していません") if category.book_id != book_id
    category
  end
end
