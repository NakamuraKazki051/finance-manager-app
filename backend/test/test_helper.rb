ENV["RAILS_ENV"] ||= "test"
require_relative "../config/environment"
require "rails/test_help"

# テストではパスワードのハッシュ計算を最小限にして速くする
BCrypt::Engine.cost = BCrypt::Engine::MIN_COST

module ActiveSupport
  class TestCase
    # メモリの少ないPCで動かすため、並列実行はしない
    parallelize(workers: 1)
  end
end

# API 経由でユーザー・家計簿・カテゴリ・取引を作るヘルパー。
# どのメソッドも、別ユーザーとして操作したいときは open_session で作ったセッションを as: に渡す
module ApiTestHelper
  PASSWORD = "correcthorsebattery".freeze

  def json_body(sess = self)
    sess.response.parsed_body
  end

  def register_and_login(sess = self, email: "test-#{SecureRandom.uuid}@example.com")
    sess.post "/api/users/register", params: { email: email, password: PASSWORD }, as: :json
    assert_equal 201, sess.response.status, sess.response.body
    sess.post "/api/auth/login", params: { email: email, password: PASSWORD }, as: :json
    assert_equal 200, sess.response.status, sess.response.body
    email
  end

  def other_user_session
    open_session.tap { |sess| register_and_login(sess) }
  end

  # 家計簿を作る(初期カテゴリも一緒に作られる)
  def create_book(name = "家計簿", as: self)
    as.post "/api/books", params: { name: name }, as: :json
    assert_equal 201, as.response.status, as.response.body
    json_body(as)["id"]
  end

  def categories_of(book_id, as: self)
    as.get "/api/books/#{book_id}/categories"
    assert_equal 200, as.response.status, as.response.body
    json_body(as)
  end

  def create_category(book_id, name, type)
    post "/api/books/#{book_id}/categories", params: { name: name, type: type }, as: :json
    assert_response :created
    json_body["id"]
  end

  def create_transaction(book_id, category_id, amount, date, extra = {}, as: self)
    as.post "/api/books/#{book_id}/transactions",
            params: { categoryId: category_id, amount: amount, date: date }.merge(extra), as: :json
    assert_equal 201, as.response.status, as.response.body
    json_body(as)["id"]
  end

  def list_transactions(book_id, query = {})
    get "/api/books/#{book_id}/transactions", params: query
    assert_response :ok
    json_body
  end

  def amounts(transactions)
    transactions.map { |t| t["amount"] }
  end
end

class ActionDispatch::IntegrationTest
  include ApiTestHelper
end
