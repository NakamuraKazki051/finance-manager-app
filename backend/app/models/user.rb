class User < ApplicationRecord
  # BCrypt は72バイトまでしか扱えない。全角文字は1文字3バイトなので、72文字以内でも超えることがある
  BCRYPT_MAX_BYTES = 72

  # 未登録のメールアドレスでログインされたときにも照合に使うダミーのハッシュ(応答時間で登録の有無を推測させない)
  DUMMY_PASSWORD_DIGEST = BCrypt::Password.create(SecureRandom.hex(16))

  has_many :books, dependent: nil

  def self.normalize_email(email)
    email.to_s.strip.downcase
  end

  def self.password_too_long?(password)
    password.to_s.bytesize > BCRYPT_MAX_BYTES
  end

  def password=(raw)
    self.password_digest = BCrypt::Password.create(raw)
  end

  # 72バイトを超えるパスワードは登録できないので、一致することはない
  def authenticate?(raw)
    self.class.password_matches?(raw, password_digest)
  end

  def self.password_matches?(raw, digest)
    return false if password_too_long?(raw)
    BCrypt::Password.new(digest).is_password?(raw)
  end

  # セッションに入れる「ログインした時点のパスワード」の目印。パスワードが変わると一致しなくなり、他の端末のセッションが切れる
  def credential_fingerprint
    Digest::SHA256.hexdigest(password_digest)
  end

  def as_api_json
    { id: id, email: email, createdAt: created_at&.utc&.iso8601(3) }
  end
end
