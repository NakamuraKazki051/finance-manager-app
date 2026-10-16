require "test_helper"

# 複数タブ・二重ログインで初期の家計簿作成が同時に走っても、家計簿と初期カテゴリが1組しか作られないことの確認。
# 各リクエストが実際にコミットされる必要があるため、他のテストと違いトランザクションで包まない
class BookEnsureDefaultConcurrencyTest < ActionDispatch::IntegrationTest
  self.use_transactional_tests = false

  CONCURRENT_REQUESTS = 4

  teardown do
    user = User.find_by(email: @email)
    next unless user
    book_ids = Book.where(user_id: user.id).pluck(:id)
    Category.where(book_id: book_ids).delete_all
    Book.where(id: book_ids).delete_all
    user.delete
  end

  test "concurrent ensure-default creates only one book" do
    @email = register_and_login
    session_cookie = cookies["_finance_manager_session"]

    sessions = Array.new(CONCURRENT_REQUESTS) do
      open_session.tap { |sess| sess.cookies["_finance_manager_session"] = session_cookie }
    end
    start = Queue.new
    threads = sessions.map do |sess|
      Thread.new do
        start.pop
        Rails.application.executor.wrap { sess.post "/api/books/ensure-default" }
        sess.response.status
      end
    end
    CONCURRENT_REQUESTS.times { start << true }
    assert_equal [200] * CONCURRENT_REQUESTS, threads.map(&:value)

    user = User.find_by!(email: @email)
    books = Book.where(user_id: user.id).to_a
    assert_equal 1, books.size
    assert_equal 6, Category.where(book_id: books.first.id).count
  end
end
