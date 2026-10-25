class AuthController < ApplicationController
  # 1つのメールアドレスに対して、この回数を超えるログインは一定時間受け付けない(パスワードの総当たり対策)。
  # 数えるのはメールアドレスごと(IP ごとにすると、同じ回線の人や E2E テストの多数のユーザーまで止まる)。
  # Puma は1プロセスなので、回数はプロセスのメモリに置けば足りる
  LOGIN_ATTEMPTS = 10
  LOGIN_WINDOW = 5.minutes
  rate_limit to: LOGIN_ATTEMPTS, within: LOGIN_WINDOW, only: :login,
             by: -> { User.normalize_email(params[:email]) },
             with: -> { render_error(429, "ログインの試行回数が多すぎます。5分ほど待ってからもう一度お試しください") },
             store: ActiveSupport::Cache::MemoryStore.new

  # POST /api/auth/login
  def login
    email = params[:email]
    password = params[:password]
    unless email.is_a?(String) && email.present? && password.is_a?(String) && password.present?
      raise ApiError.bad_request("メールアドレスとパスワードを入力してください")
    end

    user = User.find_by(email: User.normalize_email(email))
    # BCrypt の照合は意図的に遅い。未登録のときに照合を省くと応答が速くなり、登録の有無を推測されるため、必ず1回照合する
    matches = User.password_matches?(password, user ? user.password_digest : User::DUMMY_PASSWORD_DIGEST)
    raise ApiError.unauthorized("メールアドレスまたはパスワードが正しくありません") unless user && matches

    sign_in(user)
    render json: user.as_api_json
  end

  # POST /api/auth/logout
  def logout
    reset_session
    head :no_content
  end

  # GET /api/auth/me
  def me
    user = User.find_by(id: current_user_id!) or raise ApiError.unauthorized("ログインしていません")
    render json: user.as_api_json
  end
end
