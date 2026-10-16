class AuthController < ApplicationController
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
