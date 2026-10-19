require "test_helper"

# 複数タブで家計簿を同時に開き、固定費の取引作成(generate)が同時に走っても、同じ月の取引が1件しか作られないことの確認。
# 各リクエストが実際にコミットされる必要があるため、他のテストと違いトランザクションで包まない
class RecurringGenerateConcurrencyTest < ActionDispatch::IntegrationTest
  self.use_transactional_tests = false

  CONCURRENT_REQUESTS = 4

  teardown do
    travel_back
    user = User.find_by(email: @email)
    next unless user
    book_ids = Book.where(user_id: user.id).pluck(:id)
    Entry.where(book_id: book_ids).delete_all
    RecurringEntry.where(book_id: book_ids).delete_all
    Category.where(book_id: book_ids).delete_all
    Book.where(id: book_ids).delete_all
    user.delete
  end

  test "concurrent generate creates each month only once" do
    travel_to Time.zone.local(2026, 10, 19, 12)
    @email = register_and_login
    book_id = create_book
    housing = categories_of(book_id)[4]["id"]
    post "/api/books/#{book_id}/recurring-transactions", params: { categoryId: housing, amount: 80_000, day: 27 }, as: :json
    assert_response :created

    # 3か月後に複数タブで同時に開いたことにする
    travel_to Time.zone.local(2027, 1, 5, 12)
    session_cookie = cookies["_finance_manager_session"]
    sessions = Array.new(CONCURRENT_REQUESTS) do
      open_session.tap { |sess| sess.cookies["_finance_manager_session"] = session_cookie }
    end
    start = Queue.new
    threads = sessions.map do |sess|
      Thread.new do
        start.pop
        Rails.application.executor.wrap { sess.post "/api/books/#{book_id}/recurring-transactions/generate" }
        [sess.response.status, sess.response.parsed_body["created"]]
      end
    end
    CONCURRENT_REQUESTS.times { start << true }
    results = threads.map(&:value)
    assert_equal [200] * CONCURRENT_REQUESTS, results.map(&:first)
    assert_equal 3, results.sum(&:last)

    dates = Entry.where(book_id: book_id).order(:transaction_date).pluck(:transaction_date).map(&:iso8601)
    assert_equal %w[2026-10-27 2026-11-27 2026-12-27 2027-01-27], dates
  end
end
