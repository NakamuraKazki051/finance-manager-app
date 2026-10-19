require "test_helper"

# 取引の「予定/確定」(F-13)
class PlannedTransactionsTest < ActionDispatch::IntegrationTest
  setup do
    register_and_login
    @book_id = create_book("家計簿")
    categories = categories_of(@book_id)
    @salary, @food = categories[0..1].map { |c| c["id"] }
  end

  def summary(month)
    get "/api/books/#{@book_id}/summary", params: { month: month }
    assert_response :ok
    json_body
  end

  def confirm(id, confirmed, as: self)
    as.patch "/api/transactions/#{id}/confirm", params: { confirmed: confirmed }, as: :json
  end

  test "transactions are confirmed unless created as planned" do
    confirmed = create_transaction(@book_id, @food, 100, "2026-10-01")
    planned = create_transaction(@book_id, @food, 200, "2026-10-02", { confirmed: false })
    statuses = [confirmed, planned].map do |id|
      get "/api/transactions/#{id}"
      json_body["confirmed"]
    end
    assert_equal [true, false], statuses
  end

  test "rejects a confirmed value that is not a boolean" do
    ["true", 1, "予定"].each do |value|
      post "/api/books/#{@book_id}/transactions",
           params: { categoryId: @food, amount: 100, date: "2026-10-01", confirmed: value }, as: :json
      assert_response :bad_request, value.inspect
    end
    assert_empty list_transactions(@book_id)
  end

  test "update keeps the status when confirmed is omitted" do
    id = create_transaction(@book_id, @food, 100, "2026-10-01", { confirmed: false })
    put "/api/transactions/#{id}", params: { categoryId: @food, amount: 300, date: "2026-10-01" }, as: :json
    assert_response :ok
    assert_equal [300, false], json_body.values_at("amount", "confirmed")

    put "/api/transactions/#{id}", params: { categoryId: @food, amount: 300, date: "2026-10-01", confirmed: true }, as: :json
    assert_response :ok
    assert_equal true, json_body["confirmed"]
  end

  test "confirm switches between planned and confirmed" do
    id = create_transaction(@book_id, @food, 100, "2026-10-01")
    confirm(id, false)
    assert_response :ok
    assert_equal false, json_body["confirmed"]
    confirm(id, true)
    assert_response :ok
    assert_equal true, json_body["confirmed"]

    patch "/api/transactions/#{id}/confirm", params: {}, as: :json
    assert_response :bad_request
    confirm(id, "false")
    assert_response :bad_request
    confirm("no-such-id", true)
    assert_response :not_found
  end

  test "another user cannot change the status" do
    id = create_transaction(@book_id, @food, 100, "2026-10-01")
    other = other_user_session
    confirm(id, false, as: other)
    assert_equal 404, other.response.status
    get "/api/transactions/#{id}"
    assert_equal true, json_body["confirmed"]
  end

  test "summary leaves planned transactions out of the totals and reports them separately" do
    create_transaction(@book_id, @salary, 250_000, "2026-10-25")
    create_transaction(@book_id, @salary, 30_000, "2026-10-31", { confirmed: false })
    create_transaction(@book_id, @food, 1000, "2026-10-01")
    create_transaction(@book_id, @food, 500, "2026-10-01", { confirmed: false })
    create_transaction(@book_id, @food, 700, "2026-10-31", { confirmed: false })
    # 月の外の予定は入らない
    create_transaction(@book_id, @food, 9000, "2026-09-30", { confirmed: false })
    create_transaction(@book_id, @food, 9000, "2026-11-01", { confirmed: false })

    s = summary("2026-10")
    assert_equal [250_000, 1000, 249_000, 30_000, 1200, 5],
                 s.values_at("income", "expense", "balance", "plannedIncome", "plannedExpense", "count")
    food = s["categories"].find { |c| c["categoryId"] == @food }
    assert_equal [1000, 1200, 3], food.values_at("total", "plannedTotal", "count")
    other = s["categories"].find { |c| ![@salary, @food].include?(c["categoryId"]) }
    assert_equal [0, 0, 0], other.values_at("total", "plannedTotal", "count")
  end

  test "planned transactions on Feb 29 of a leap year belong to February" do
    create_transaction(@book_id, @food, 400, "2028-02-29", { confirmed: false })
    assert_equal 400, summary("2028-02")["plannedExpense"]
    assert_equal 0, summary("2028-03")["plannedExpense"]
  end

  test "confirming a planned transaction moves it into the totals" do
    id = create_transaction(@book_id, @food, 800, "2026-10-10", { confirmed: false })
    assert_equal [0, 800], summary("2026-10").values_at("expense", "plannedExpense")
    confirm(id, true)
    assert_equal [800, 0], summary("2026-10").values_at("expense", "plannedExpense")
  end

  test "monthly trend counts confirmed transactions only" do
    create_transaction(@book_id, @salary, 1000, "2026-10-01")
    create_transaction(@book_id, @salary, 500, "2026-10-02", { confirmed: false })
    create_transaction(@book_id, @food, 300, "2026-10-03", { confirmed: false })
    get "/api/books/#{@book_id}/summary/monthly", params: { from: "2026-10", to: "2026-10" }
    assert_response :ok
    assert_equal [1000, 0, 1000], json_body["months"][0].values_at("income", "expense", "balance")
  end

  test "status filters the list" do
    create_transaction(@book_id, @food, 100, "2026-10-01")
    create_transaction(@book_id, @food, 200, "2026-10-02", { confirmed: false })
    assert_equal [200, 100], amounts(list_transactions(@book_id, month: "2026-10"))
    assert_equal [100], amounts(list_transactions(@book_id, month: "2026-10", status: "confirmed"))
    assert_equal [200], amounts(list_transactions(@book_id, month: "2026-10", status: "planned"))
    get "/api/books/#{@book_id}/transactions", params: { status: "done" }
    assert_response :bad_request
  end

  test "CSV shows the status" do
    create_transaction(@book_id, @food, 100, "2026-10-01", { confirmed: false })
    get "/api/books/#{@book_id}/export.csv", params: { month: "2026-10" }
    assert_response :ok
    assert response.body.dup.force_encoding("UTF-8").include?(%("2026-10-01","支出","食費",100,"","","予定"))
  end

  test "import keeps the status and treats old backups as confirmed" do
    backup = {
      categories: [{ id: "c1", name: "食費", type: "EXPENSE" }],
      transactions: [
        { categoryId: "c1", amount: 100, date: "2026-10-01", confirmed: false },
        { categoryId: "c1", amount: 200, date: "2026-10-02" }
      ]
    }
    put "/api/books/#{@book_id}/import", params: backup, as: :json
    assert_response :no_content
    assert_equal [[200, true], [100, false]], list_transactions(@book_id).map { |t| t.values_at("amount", "confirmed") }

    backup[:transactions][0][:confirmed] = "no"
    put "/api/books/#{@book_id}/import", params: backup, as: :json
    assert_response :bad_request
    assert_equal 2, list_transactions(@book_id).size
  end
end
