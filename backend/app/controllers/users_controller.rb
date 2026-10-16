class UsersController < ApplicationController
  EMAIL_FORMAT = /\A[^@\s]+@[^@\s]+\z/

  # POST /api/users/register
  def register
    email = email_value(params[:email], required: true)
    password = password_value(params[:password], required: true)
    raise ApiError.conflict("このメールアドレスは既に登録されています: #{email}") if User.exists?(email: email)

    user = User.create!(email: email, password: password)
    render json: user.as_api_json, status: :created
  end

  # PUT /api/users/me  {email?, newPassword?, currentPassword}
  def update_me
    user = User.find_by(id: current_user_id!) or raise ApiError.unauthorized("ログインしていません")
    current_password = params[:currentPassword]
    raise ApiError.bad_request("現在のパスワードを入力してください") unless current_password.is_a?(String) && current_password.present?
    raise ApiError.bad_request("パスワードが長すぎます(72バイトまで。全角文字は1文字3バイト)") if User.password_too_long?(current_password)
    raise ApiError.bad_request("現在のパスワードが正しくありません") unless user.authenticate?(current_password)

    email = email_value(params[:email], required: false)
    if email && email != user.email
      raise ApiError.conflict("このメールアドレスは既に登録されています: #{email}") if User.exists?(email: email)
      user.email = email
    end
    new_password = password_value(params[:newPassword], required: false)
    user.password = new_password if new_password
    user.save!

    # 他の端末のセッションはパスワードの目印が合わなくなって切れる。変更した本人のセッションだけ新しいパスワードで維持する
    sign_in(user) if new_password
    render json: user.as_api_json
  end

  private

  def email_value(value, required:)
    return nil if !required && (value.nil? || (value.is_a?(String) && value.strip.empty?))
    raise ApiError.bad_request("メールアドレスを入力してください") unless value.is_a?(String) && value.strip.present?
    raise ApiError.bad_request("メールアドレスは255文字以内で入力してください") if value.length > 255
    email = User.normalize_email(value)
    raise ApiError.bad_request("メールアドレスの形式が正しくありません") unless email.match?(EMAIL_FORMAT)
    email
  end

  def password_value(value, required:)
    return nil if !required && (value.nil? || value == "")
    raise ApiError.bad_request("パスワードを入力してください") unless value.is_a?(String) && value.present?
    raise ApiError.bad_request("パスワードは8〜72文字で入力してください") unless value.length.between?(8, 72)
    raise ApiError.bad_request("パスワードが長すぎます(72バイトまで。全角文字は1文字3バイト)") if User.password_too_long?(value)
    value
  end
end
