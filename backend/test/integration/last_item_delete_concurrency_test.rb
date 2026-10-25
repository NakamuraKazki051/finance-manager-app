require "test_helper"

# 2つのタブで「残り2冊の家計簿」「残り2つのカテゴリ」を同時に削除しても、最後の1つまでは消えないことの確認。
# 各リクエストが実際にコミットされる必要があるため、他のテストと違いトランザクションで包まない
class LastItemDeleteConcurrencyTest < ActionDispatch::IntegrationTest
  self.use_transactional_tests = false

  # 同時に届くタイミングは毎回少しずつ違うので、何回か繰り返して確かめる
  ROUNDS = 5

  teardown do
    @emails&.each do |email|
      user = User.find_by(email: email) or next
      book_ids = Book.where(user_id: user.id).pluck(:id)
      Entry.where(book_id: book_ids).delete_all
      Category.where(book_id: book_ids).delete_all
      Book.where(id: book_ids).delete_all
      user.delete
    end
  end

  test "deleting the last two books at the same time keeps one" do
    ROUNDS.times do
      login_fresh_user
      first = create_book("家計簿1")
      second = create_book("家計簿2")

      statuses = concurrently(["/api/books/#{first}", "/api/books/#{second}"])
      assert_equal [204, 400], statuses.sort
      assert_equal 1, Book.where(user_id: User.find_by!(email: @emails.last).id).count
    end
  end

  test "deleting the last two categories at the same time keeps one" do
    ROUNDS.times do
      login_fresh_user
      book_id = create_book
      first, second, *rest = categories_of(book_id).map { |c| c["id"] }
      rest.each do |id|
        delete "/api/categories/#{id}"
        assert_response :no_content
      end

      statuses = concurrently(["/api/categories/#{first}", "/api/categories/#{second}"])
      assert_equal [204, 400], statuses.sort
      assert_equal 1, Category.where(book_id: book_id).count
    end
  end

  private

  def login_fresh_user
    (@emails ||= []) << register_and_login
  end

  # 同じログインのセッションで、DELETE を同時に送る。応答のステータスを送った順に返す
  def concurrently(paths)
    session_cookie = cookies["_finance_manager_session"]
    start = Queue.new
    threads = paths.map do |path|
      sess = open_session.tap { |s| s.cookies["_finance_manager_session"] = session_cookie }
      Thread.new do
        start.pop
        Rails.application.executor.wrap { sess.delete path }
        sess.response.status
      end
    end
    paths.size.times { start << true }
    threads.map(&:value)
  end
end
