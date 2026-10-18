require "test_helper"

class SummaryMonthlyTest < ActionDispatch::IntegrationTest
  setup do
    register_and_login
    @book_id = create_book("家計簿")
    @salary, @food, @daily = categories_of(@book_id)[0..2].map { |c| c["id"] }
  end

  def monthly(from, to)
    get "/api/books/#{@book_id}/summary/monthly", params: { from: from, to: to }
  end

  test "totals income and expense per month, including empty months" do
    create_transaction(@book_id, @salary, 250_000, "2026-08-25")
    create_transaction(@book_id, @food, 1_000, "2026-08-01")
    create_transaction(@book_id, @daily, 500, "2026-08-31")
    create_transaction(@book_id, @food, 3_000, "2026-10-15")
    # 期間の外は数えない
    create_transaction(@book_id, @food, 9_999, "2026-07-31")
    create_transaction(@book_id, @food, 9_999, "2026-11-01")

    monthly("2026-08", "2026-10")
    assert_response :ok
    assert_equal %w[2026-08 2026-10], json_body.values_at("from", "to")
    assert_equal [
      { "month" => "2026-08", "income" => 250_000, "expense" => 1_500, "balance" => 248_500 },
      { "month" => "2026-09", "income" => 0, "expense" => 0, "balance" => 0 },
      { "month" => "2026-10", "income" => 0, "expense" => 3_000, "balance" => -3_000 }
    ], json_body["months"]
  end

  test "spans a year boundary and counts by the category's current type" do
    create_transaction(@book_id, @food, 700, "2025-12-31")
    create_transaction(@book_id, @food, 300, "2026-01-01")
    # 食費を収入に切り替えると、過去の月も収入として集計される
    put "/api/categories/#{@food}", params: { type: "INCOME" }, as: :json
    assert_response :ok

    monthly("2025-12", "2026-01")
    assert_equal [[700, 0], [300, 0]], json_body["months"].map { |m| m.values_at("income", "expense") }
  end

  test "accepts up to 24 months and rejects bad ranges" do
    monthly("2024-11", "2026-10")
    assert_response :ok
    assert_equal 24, json_body["months"].size

    monthly("2024-10", "2026-10")
    assert_response :bad_request
    monthly("2026-10", "2026-09")
    assert_response :bad_request
    monthly("2026-13", "2026-10")
    assert_response :bad_request
    get "/api/books/#{@book_id}/summary/monthly", params: { from: "2026-01" }
    assert_response :bad_request
  end

  test "requires login and hides other users' books" do
    other = other_user_session
    other.get "/api/books/#{@book_id}/summary/monthly", params: { from: "2026-01", to: "2026-02" }
    assert_equal 404, other.response.status

    post "/api/auth/logout"
    monthly("2026-01", "2026-02")
    assert_response :unauthorized
  end
end
