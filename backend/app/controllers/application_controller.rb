class ApplicationController < ActionController::API
  MALFORMED_MESSAGE = "リクエストの形式が不正です".freeze

  # 後に書いたものほど優先される。想定外のエラーは最後の砦として 500 にする
  rescue_from StandardError do |e|
    Rails.logger.error("Unexpected error handling request: #{e.class}: #{e.message}\n#{e.backtrace&.first(10)&.join("\n")}")
    render_error(500, "サーバーエラーが発生しました")
  end
  rescue_from ActionDispatch::Http::Parameters::ParseError, ActionController::BadRequest do
    render_error(400, MALFORMED_MESSAGE)
  end
  rescue_from ActionController::ParameterMissing do |e|
    render_error(400, "#{e.param} を指定してください")
  end
  # メールアドレスの存在チェックと保存の間に、同じメールアドレスが登録された場合
  rescue_from ActiveRecord::RecordNotUnique do
    render_error(409, "このメールアドレスは既に登録されています")
  end
  rescue_from ApiError do |e|
    render_error(e.status, e.message)
  end

  # どのルートにも当たらない /api/ 以下のURL
  def route_not_found
    render_error(404, "リクエストを処理できません")
  end

  private

  def render_error(status, message)
    render json: { timestamp: Time.now.utc.iso8601(3), status: status, message: message }, status: status
  end

  # --- ログイン ---

  def current_user_id!
    user_id = session[:user_id]
    raise ApiError.unauthorized("ログインが必要です") if user_id.blank?

    user = User.find_by(id: user_id)
    still_valid = user && ActiveSupport::SecurityUtils.secure_compare(user.credential_fingerprint, session[:credential].to_s)
    unless still_valid
      reset_session
      raise ApiError.unauthorized("ログインの有効期限が切れました(パスワードが変更された可能性があります)。もう一度ログインしてください")
    end
    user_id
  end

  # ログイン状態をセッションに記録する。ログイン前のセッションは使い回さない(セッション固定攻撃対策)
  def sign_in(user)
    reset_session
    session[:user_id] = user.id
    session[:credential] = user.credential_fingerprint
  end

  # 他ユーザーの家計簿は 403 ではなく 404 にする(存在自体を隠すため)
  def require_book!(book_id, user_id)
    raise ApiError.not_found("家計簿が見つかりません: #{book_id}") unless Book.exists?(id: book_id, user_id: user_id)
  end

  # 取引・固定費に付けるカテゴリ。家計簿の所有者の確認(require_book!)を済ませてから呼ぶ
  def category_in_book!(category_id, book_id)
    raise ApiError.bad_request("カテゴリを指定してください") unless category_id.is_a?(String) && category_id.present?
    category = Category.find_by(id: category_id) or raise ApiError.not_found("カテゴリが見つかりません: #{category_id}")
    raise ApiError.bad_request("指定したカテゴリはこの家計簿に属していません") if category.book_id != book_id
    category
  end

  # --- 入力チェック(フロントの maxlength と同じ上限にする。超えた値でDBエラーの 500 にしない) ---

  def required_string(value, max:, blank_message:, too_long_message:)
    raise ApiError.bad_request(blank_message) unless value.is_a?(String) && value.strip.present?
    raise ApiError.bad_request(too_long_message) if value.length > max
    value
  end

  def optional_string(value, max:, too_long_message:)
    return nil if value.nil?
    raise ApiError.bad_request(MALFORMED_MESSAGE) unless value.is_a?(String)
    raise ApiError.bad_request(too_long_message) if value.length > max
    value
  end

  def category_kind(value)
    raise ApiError.bad_request("収入か支出かを指定してください") unless Category::KINDS.include?(value)
    value
  end

  # 金額は円の整数。1.5 のような小数や "100" のような文字列は受け付けない(勝手に丸めない)
  def amount_value(value)
    raise ApiError.bad_request("金額を入力してください") if value.nil?
    raise ApiError.bad_request("金額は整数(円)で入力してください") unless value.is_a?(Integer)
    raise ApiError.bad_request("金額は1円以上で入力してください") if value < 1
    raise ApiError.bad_request("金額は99,999,999円以下で入力してください") if value > Entry::MAX_AMOUNT
    value
  end

  # 月間予算(円の整数)。null は「予算なし」
  def budget_value(value)
    return nil if value.nil?
    unless value.is_a?(Integer) && value.between?(1, Entry::MAX_AMOUNT)
      raise ApiError.bad_request("予算は1〜99,999,999円の整数で入力してください")
    end
    value
  end

  def date_value(value)
    raise ApiError.bad_request("日付を入力してください") if value.nil?
    unless value.is_a?(String) && value.match?(/\A\d{4}-\d{2}-\d{2}\z/)
      raise ApiError.bad_request("日付は YYYY-MM-DD の形式で入力してください")
    end
    Date.strptime(value, "%Y-%m-%d")
  rescue Date::Error
    raise ApiError.bad_request("存在しない日付です: #{value}")
  end

  def tags_value(value)
    return [] if value.nil?
    raise ApiError.bad_request(MALFORMED_MESSAGE) unless value.is_a?(Array) && value.all?(String)
    raise ApiError.bad_request("タグは1つ30文字以内で入力してください") if value.any? { |tag| tag.length > 30 }
    value
  end

  # month(YYYY-MM)を、その月の1日の Date にする
  def month_value(value)
    unless value.is_a?(String) && value.match?(/\A\d{4}-\d{2}\z/)
      raise ApiError.bad_request("月は YYYY-MM の形式で指定してください: #{value}")
    end
    Date.strptime("#{value}-01", "%Y-%m-%d")
  rescue Date::Error
    raise ApiError.bad_request("月は YYYY-MM の形式で指定してください: #{value}")
  end

  def integer_query(name)
    value = params[name]
    return nil if value.blank?
    Integer(value, 10)
  rescue ArgumentError, TypeError
    raise ApiError.bad_request("パラメータの値が不正です: #{name}")
  end

  # 固定費(F-12)の毎月の日付。29〜31日は、その日が無い月では月末になる
  def day_value(value)
    raise ApiError.bad_request("毎月の日付を指定してください") if value.nil?
    raise ApiError.bad_request("毎月の日付は1〜31の整数で指定してください") unless value.is_a?(Integer) && value.between?(1, 31)
    value
  end

  # 予定/確定(F-13)。省略したときは default を使う。"true" のような文字列は受け付けない
  def confirmed_value(value, default:)
    return default if value.nil?
    raise ApiError.bad_request("予定か確定かは true か false で指定してください") unless [true, false].include?(value)
    value
  end

  def memo_value(value)
    memo = optional_string(value, max: 100, too_long_message: "メモは100文字以内で入力してください")&.strip
    memo.presence
  end
end
