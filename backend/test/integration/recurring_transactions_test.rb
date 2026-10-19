require "test_helper"

# 固定費の繰り返し(F-12)
class RecurringTransactionsTest < ActionDispatch::IntegrationTest
  setup do
    travel_to Time.zone.local(2026, 10, 19, 12)
    register_and_login
    @book_id = create_book("家計簿")
    categories = categories_of(@book_id)
    @salary, @food, @housing = categories.values_at(0, 1, 4).map { |c| c["id"] }
  end

  teardown { travel_back }

  def create_rule(body, as: self)
    as.post "/api/books/#{@book_id}/recurring-transactions", params: body, as: :json
  end

  def rule_payload(extra = {})
    { categoryId: @housing, amount: 80_000, day: 27, memo: "家賃", tags: ["固定費"] }.merge(extra)
  end

  def generate(as: self)
    as.post "/api/books/#{@book_id}/recurring-transactions/generate"
    assert_equal 200, as.response.status, as.response.body
    json_body(as)["created"]
  end

  test "creating a rule makes a planned transaction for this month" do
    create_rule(rule_payload)
    assert_response :created
    rule = json_body
    assert_equal [80_000, 27, "家賃", ["固定費"], "2026-10", "2026-10"],
                 rule.values_at("amount", "day", "memo", "tags", "startMonth", "lastGeneratedMonth")

    txns = list_transactions(@book_id, month: "2026-10")
    assert_equal 1, txns.size
    assert_equal ["2026-10-27", 80_000, @housing, "家賃", ["固定費"], false, rule["id"]],
                 txns[0].values_at("date", "amount", "categoryId", "memo", "tags", "confirmed", "recurringId")
  end

  test "a past start month fills every month up to now, and generate does not duplicate" do
    create_rule(rule_payload(startMonth: "2026-08"))
    assert_response :created
    assert_equal %w[2026-10-27 2026-09-27 2026-08-27], list_transactions(@book_id).map { |t| t["date"] }
    assert_equal 0, generate
    assert_equal 3, list_transactions(@book_id).size
  end

  test "a future start month creates nothing until that month comes" do
    create_rule(rule_payload(startMonth: "2026-12"))
    assert_response :created
    assert_nil json_body["lastGeneratedMonth"]
    assert_equal 0, generate
    assert_empty list_transactions(@book_id)

    travel_to Time.zone.local(2026, 12, 1, 0, 5)
    assert_equal 1, generate
    assert_equal ["2026-12-27"], list_transactions(@book_id).map { |t| t["date"] }
  end

  test "generate catches up on the months that passed" do
    create_rule(rule_payload(day: 5))
    travel_to Time.zone.local(2027, 1, 3)
    assert_equal 3, generate
    assert_equal %w[2027-01-05 2026-12-05 2026-11-05 2026-10-05], list_transactions(@book_id).map { |t| t["date"] }
  end

  test "days missing from a month fall on its last day, including Feb 29 of a leap year" do
    travel_to Time.zone.local(2028, 3, 10)
    create_rule(rule_payload(day: 31, startMonth: "2027-11"))
    assert_response :created
    assert_equal %w[2028-03-31 2028-02-29 2028-01-31 2027-12-31 2027-11-30],
                 list_transactions(@book_id).map { |t| t["date"] }

    travel_to Time.zone.local(2027, 2, 1)
    other_book = create_book("別")
    housing = categories_of(other_book)[4]["id"]
    post "/api/books/#{other_book}/recurring-transactions", params: rule_payload(categoryId: housing, day: 30), as: :json
    assert_response :created
    assert_equal ["2027-02-28"], list_transactions(other_book).map { |t| t["date"] }
  end

  test "a deleted generated transaction is not made again" do
    create_rule(rule_payload)
    txn_id = list_transactions(@book_id)[0]["id"]
    delete "/api/transactions/#{txn_id}"
    assert_response :no_content
    assert_equal 0, generate
    assert_empty list_transactions(@book_id)
  end

  test "generated transactions are planned and leave the totals until confirmed" do
    create_rule(rule_payload)
    get "/api/books/#{@book_id}/summary", params: { month: "2026-10" }
    assert_equal [0, 80_000], json_body.values_at("expense", "plannedExpense")
  end

  test "lists rules by day and updates only future transactions" do
    create_rule(rule_payload(day: 27))
    rent = json_body["id"]
    create_rule(rule_payload(categoryId: @salary, amount: 250_000, day: 25, memo: "給料", tags: []))
    get "/api/books/#{@book_id}/recurring-transactions"
    assert_response :ok
    assert_equal [25, 27], json_body.map { |r| r["day"] }

    put "/api/recurring-transactions/#{rent}", params: rule_payload(amount: 85_000, day: 26), as: :json
    assert_response :ok
    assert_equal [85_000, 26, "2026-10"], json_body.values_at("amount", "day", "lastGeneratedMonth")
    # 作り済みの今月の取引はそのまま、来月からは新しい金額
    assert_equal [80_000], amounts(list_transactions(@book_id, month: "2026-10", tag: "固定費"))
    travel_to Time.zone.local(2026, 11, 2)
    generate
    nov = list_transactions(@book_id, month: "2026-11").select { |t| t["recurringId"] == rent }
    assert_equal [["2026-11-26", 85_000]], nov.map { |t| t.values_at("date", "amount") }
  end

  test "deleting a rule keeps its transactions and stops new ones" do
    create_rule(rule_payload)
    rule = json_body["id"]
    delete "/api/recurring-transactions/#{rule}"
    assert_response :no_content
    txns = list_transactions(@book_id)
    assert_equal 1, txns.size
    assert_nil txns[0]["recurringId"]

    travel_to Time.zone.local(2026, 11, 2)
    assert_equal 0, generate
    get "/api/books/#{@book_id}/recurring-transactions"
    assert_empty json_body
  end

  test "deleting the category or the book removes its rules" do
    create_rule(rule_payload)
    delete "/api/categories/#{@housing}"
    assert_response :no_content
    assert_equal 0, RecurringEntry.where(book_id: @book_id).count

    create_rule(rule_payload(categoryId: @food))
    create_book("別") # 最後の1冊は消せないので、もう1冊作っておく
    delete "/api/books/#{@book_id}"
    assert_response :no_content
    assert_equal 0, RecurringEntry.where(book_id: @book_id).count
  end

  test "rejects invalid input" do
    [0, 32, 1.5, "5", nil].each do |day|
      create_rule(rule_payload(day: day))
      assert_response :bad_request, "day=#{day.inspect}"
    end
    [0, 100_000_000, "100"].each do |amount|
      create_rule(rule_payload(amount: amount))
      assert_response :bad_request, "amount=#{amount.inspect}"
    end
    %w[2025-09 2027-11 2026-13 2026/10].each do |month|
      create_rule(rule_payload(startMonth: month))
      assert_response :bad_request, "startMonth=#{month}"
    end
    create_rule(rule_payload(memo: "あ" * 101))
    assert_response :bad_request
    create_rule(rule_payload(categoryId: categories_of(create_book("別"))[1]["id"]))
    assert_response :bad_request

    # 前後12か月ちょうどは登録できる
    create_rule(rule_payload(startMonth: "2025-10"))
    assert_response :created
    create_rule(rule_payload(startMonth: "2027-10"))
    assert_response :created
    assert_equal 2, RecurringEntry.where(book_id: @book_id).count
  end

  test "other users cannot see or change rules" do
    create_rule(rule_payload)
    rule = json_body["id"]
    other = other_user_session

    other.get "/api/books/#{@book_id}/recurring-transactions"
    assert_equal 404, other.response.status
    create_rule(rule_payload, as: other)
    assert_equal 404, other.response.status
    other.post "/api/books/#{@book_id}/recurring-transactions/generate"
    assert_equal 404, other.response.status
    other.put "/api/recurring-transactions/#{rule}", params: rule_payload(amount: 1), as: :json
    assert_equal 404, other.response.status
    other.delete "/api/recurring-transactions/#{rule}"
    assert_equal 404, other.response.status

    assert_equal 80_000, RecurringEntry.find(rule).amount
  end

  test "export and import keep rules, their months and links" do
    create_rule(rule_payload(startMonth: "2026-09"))
    rule = json_body
    backup = {
      categories: categories_of(@book_id).map { |c| c.slice("id", "name", "type", "budget") },
      transactions: list_transactions(@book_id).map { |t| t.slice("categoryId", "amount", "date", "memo", "tags", "confirmed", "recurringId") },
      recurring: [rule.slice("id", "categoryId", "amount", "day", "memo", "tags", "startMonth", "lastGeneratedMonth")]
    }
    put "/api/books/#{@book_id}/import", params: backup, as: :json
    assert_response :no_content

    get "/api/books/#{@book_id}/recurring-transactions"
    imported = json_body
    assert_equal [[80_000, 27, "2026-09", "2026-10"]], imported.map { |r| r.values_at("amount", "day", "startMonth", "lastGeneratedMonth") }
    assert_equal [imported[0]["id"]] * 2, list_transactions(@book_id).map { |t| t["recurringId"] }
    assert_equal 0, generate
  end

  test "import without lastGeneratedMonth treats past months as done, and invalid rules change nothing" do
    base = {
      categories: [{ id: "c1", name: "住居", type: "EXPENSE" }],
      transactions: [],
      recurring: [{ id: "r1", categoryId: "c1", amount: 1000, day: 1, startMonth: "2026-01" }]
    }
    put "/api/books/#{@book_id}/import", params: base, as: :json
    assert_response :no_content
    assert_equal 0, generate

    invalid = [
      { categoryId: "missing", amount: 1000, day: 1, startMonth: "2026-01" },
      { categoryId: "c1", amount: 1000, day: 0, startMonth: "2026-01" },
      { categoryId: "c1", amount: 1000, day: 1 },
      "not a rule"
    ]
    invalid.each do |rule|
      put "/api/books/#{@book_id}/import", params: base.merge(recurring: [rule], categories: [{ id: "c1", name: "別名", type: "EXPENSE" }]), as: :json
      assert_response :bad_request, rule.inspect
    end
    assert_equal ["住居"], categories_of(@book_id).map { |c| c["name"] }
    assert_equal 1, RecurringEntry.where(book_id: @book_id).count
  end
end
