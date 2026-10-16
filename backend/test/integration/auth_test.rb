require "test_helper"

class AuthTest < ActionDispatch::IntegrationTest
  test "registers, logs in, reads me and logs out with a session cookie" do
    post "/api/users/register", params: { email: "Alice@Example.com ", password: PASSWORD }, as: :json
    assert_response :created
    assert_equal "alice@example.com", json_body["email"], "メールアドレスは小文字にそろえる"
    assert_nil json_body["password"]
    assert_nil json_body["passwordDigest"]

    post "/api/auth/login", params: { email: "ALICE@example.com", password: PASSWORD }, as: :json
    assert_response :ok
    get "/api/auth/me"
    assert_response :ok
    assert_equal "alice@example.com", json_body["email"]

    post "/api/auth/logout"
    assert_response :no_content
    get "/api/auth/me"
    assert_response :unauthorized
  end

  test "login issues a new session cookie instead of reusing the old one" do
    email = register_and_login
    before = cookies["_finance_manager_session"]
    post "/api/auth/login", params: { email: email, password: PASSWORD }, as: :json
    assert_response :ok
    assert_not_equal before, cookies["_finance_manager_session"]
  end

  test "rejects wrong password and unknown email with the same message" do
    email = register_and_login
    post "/api/auth/logout"
    post "/api/auth/login", params: { email: email, password: "wrong-password" }, as: :json
    assert_response :unauthorized
    wrong_password_message = json_body["message"]
    post "/api/auth/login", params: { email: "nobody@example.com", password: PASSWORD }, as: :json
    assert_response :unauthorized
    assert_equal wrong_password_message, json_body["message"]
  end

  test "login with an unknown email still runs a password check" do
    checked = []
    original = User.method(:password_matches?)
    User.define_singleton_method(:password_matches?) do |raw, digest|
      checked << digest
      original.call(raw, digest)
    end
    post "/api/auth/login", params: { email: "nobody@example.com", password: PASSWORD }, as: :json
    assert_response :unauthorized
    assert_equal [User::DUMMY_PASSWORD_DIGEST], checked
  ensure
    # 差し替える前のメソッドに戻す(remove_method だと元のメソッドまで消えて、後のテストのログインが壊れる)
    User.define_singleton_method(:password_matches?, original) if original
  end

  test "me and logout without a session" do
    get "/api/auth/me"
    assert_response :unauthorized
    post "/api/auth/logout"
    assert_response :no_content
  end

  test "rejects duplicate, invalid, too long email and short password" do
    email = register_and_login
    post "/api/users/register", params: { email: email.upcase, password: PASSWORD }, as: :json
    assert_response :conflict
    post "/api/users/register", params: { email: "not-an-email", password: PASSWORD }, as: :json
    assert_response :bad_request
    long_email = "a" * 64 + "@" + ("b" * 60 + ".") * 4 + "com"
    post "/api/users/register", params: { email: long_email, password: PASSWORD }, as: :json
    assert_response :bad_request
    post "/api/users/register", params: { email: "short@example.com", password: "1234567" }, as: :json
    assert_response :bad_request
  end

  test "password longer than 72 bytes is rejected, not a server error" do
    # 全角文字は1文字3バイトなので、30文字でも72バイトを超える
    long_password = "あ" * 30
    post "/api/users/register", params: { email: "long-pw@example.com", password: long_password }, as: :json
    assert_response :bad_request
    post "/api/auth/login", params: { email: "long-pw@example.com", password: long_password }, as: :json
    assert_response :unauthorized
    register_and_login
    put "/api/users/me", params: { currentPassword: long_password }, as: :json
    assert_response :bad_request
  end

  test "changing the password logs out other sessions but keeps the current one" do
    email = register_and_login
    phone = open_session
    phone.post "/api/auth/login", params: { email: email, password: PASSWORD }, as: :json
    assert_equal 200, phone.response.status

    put "/api/users/me", params: { currentPassword: PASSWORD, newPassword: "new-password-123" }, as: :json
    assert_response :ok
    get "/api/books"
    assert_response :ok
    phone.get "/api/books"
    assert_equal 401, phone.response.status

    phone.post "/api/auth/login", params: { email: email, password: "new-password-123" }, as: :json
    assert_equal 200, phone.response.status
  end

  test "changing only the email keeps other sessions" do
    email = register_and_login
    phone = open_session
    phone.post "/api/auth/login", params: { email: email, password: PASSWORD }, as: :json

    put "/api/users/me", params: { currentPassword: PASSWORD, email: "renamed-#{SecureRandom.hex(4)}@example.com" }, as: :json
    assert_response :ok
    phone.get "/api/books"
    assert_equal 200, phone.response.status
  end

  test "update requires the right current password, a free email and a login" do
    taken = register_and_login(open_session)
    register_and_login
    put "/api/users/me", params: { currentPassword: "wrong-password", email: "x@example.com" }, as: :json
    assert_response :bad_request
    put "/api/users/me", params: { currentPassword: PASSWORD, email: taken }, as: :json
    assert_response :conflict

    post "/api/auth/logout"
    put "/api/users/me", params: { currentPassword: PASSWORD }, as: :json
    assert_response :unauthorized
  end

  test "malformed JSON is a bad request, not a server error" do
    post "/api/users/register", params: '{"email":', headers: { "CONTENT_TYPE" => "application/json" }
    assert_response :bad_request
  end
end
