# 固定費の繰り返し(F-12、RecurringEntry モデル)の API
class RecurringTransactionsController < ApplicationController
  # 開始月として選べる範囲(今月から前後この月数)。昔の月を選ぶとその月から今月までの取引をまとめて作る
  START_MONTH_RANGE = 12

  # GET /api/books/:book_id/recurring-transactions。毎月の日付の早い順
  def index
    require_book!(params[:book_id], current_user_id!)
    rules = RecurringEntry.where(book_id: params[:book_id]).order(:day_of_month, :created_at, :id)
    render json: rules.map(&:as_api_json)
  end

  # POST /api/books/:book_id/recurring-transactions  {categoryId, amount, day, memo?, tags?, startMonth?}
  # startMonth(YYYY-MM)を省くと今月から。開始月が今月以前なら、今月までの分の予定の取引をすぐに作る
  def create
    require_book!(params[:book_id], current_user_id!)
    attrs = rule_attributes(params[:book_id])
    start_month = start_month_value(params[:startMonth])
    rule = RecurringEntry.transaction do
      RecurringEntry.create!(attrs.merge(book_id: params[:book_id], start_month: start_month)).tap do |r|
        r.generate_through!(current_month)
      end
    end
    render json: rule.as_api_json, status: :created
  end

  # PUT /api/recurring-transactions/:id  {categoryId, amount, day, memo?, tags?}
  # これから作る取引にだけ効く(作り済みの取引は変えない)
  def update
    rule = find_owned_rule!
    rule.update!(rule_attributes(rule.book_id))
    render json: rule.as_api_json
  end

  # DELETE /api/recurring-transactions/:id。作り済みの取引は残す
  def destroy
    rule = find_owned_rule!
    RecurringEntry.transaction do
      Entry.where(recurring_entry_id: rule.id).update_all(recurring_entry_id: nil)
      rule.delete
    end
    head :no_content
  end

  # POST /api/books/:book_id/recurring-transactions/generate
  # 今月までで、まだ作っていない月の予定の取引を作る。画面が家計簿を開いたときに呼ぶ
  def generate
    require_book!(params[:book_id], current_user_id!)
    render json: { created: RecurringEntry.generate_for_book!(params[:book_id], through: current_month) }
  end

  private

  def rule_attributes(book_id)
    {
      amount: amount_value(params[:amount]),
      day_of_month: day_value(params[:day]),
      category_id: category_in_book!(params[:categoryId], book_id).id,
      memo: memo_value(params[:memo]),
      tags: tags_value(params[:tags])
    }
  end

  def current_month
    Time.zone.today.beginning_of_month
  end

  def start_month_value(value)
    return current_month if value.nil?
    month = month_value(value)
    unless month.between?(current_month << START_MONTH_RANGE, current_month >> START_MONTH_RANGE)
      raise ApiError.bad_request("開始月は今月の前後#{START_MONTH_RANGE}か月以内で指定してください")
    end
    month
  end

  def find_owned_rule!
    user_id = current_user_id!
    rule = RecurringEntry.find_by(id: params[:id]) or raise ApiError.not_found("固定費が見つかりません: #{params[:id]}")
    require_book!(rule.book_id, user_id)
    rule
  end
end
