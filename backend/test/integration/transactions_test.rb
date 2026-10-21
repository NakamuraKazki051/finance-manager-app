require "test_helper"

class TransactionsTest < ActionDispatch::IntegrationTest
  setup do
    register_and_login
    @book_id = create_book("家計簿")
    categories = categories_of(@book_id)
    @salary, @food, @daily = categories[0..2].map { |c| c["id"] }
  end

  def payload(category_id, amount, date)
    { categoryId: category_id, amount: amount, date: date }
  end

  def post_transaction(body)
    post "/api/books/#{@book_id}/transactions", params: body, as: :json
  end

  test "creates and reads a transaction" do
    id = create_transaction(@book_id, @food, 1280, "2026-10-16", { memo: " ランチ ", tags: %w[外食 仕事] })
    get "/api/transactions/#{id}"
    assert_response :ok
    assert_equal [1280, "2026-10-16", @food, "ランチ", %w[外食 仕事]],
                 json_body.values_at("amount", "date", "categoryId", "memo", "tags")
    assert json_body["createdAt"].present?
  end

  test "rejects invalid amount, date, memo and tags" do
    [0, -100, 100_000_000, 1.5, "100", nil].each do |amount|
      post_transaction(payload(@food, amount, "2026-10-01"))
      assert_response :bad_request, "amount=#{amount.inspect}"
    end
    [nil, "2026-02-30", "2026/10/01", "10月1日"].each do |date|
      post_transaction(payload(@food, 100, date))
      assert_response :bad_request, "date=#{date.inspect}"
    end
    post_transaction(payload(@food, 100, "2026-10-01").merge(memo: "あ" * 101))
    assert_response :bad_request
    post_transaction(payload(@food, 100, "2026-10-01").merge(tags: ["あ" * 31]))
    assert_response :bad_request
    post_transaction(payload(@food, 100, "2026-10-01").merge(tags: "外食"))
    assert_response :bad_request
    post_transaction({ amount: 100, date: "2026-10-01" })
    assert_response :bad_request

    # 上限ちょうどは登録できる
    create_transaction(@book_id, @food, 99_999_999, "2026-10-01")
    assert_equal [99_999_999], amounts(list_transactions(@book_id))
  end

  test "category from another book is rejected" do
    other_category = categories_of(create_book("別の家計簿"))[1]["id"]
    post_transaction(payload(other_category, 100, "2026-10-01"))
    assert_response :bad_request
  end

  test "month filter includes the first and last day only" do
    create_transaction(@book_id, @food, 1, "2026-09-30")
    create_transaction(@book_id, @food, 2, "2026-10-01")
    create_transaction(@book_id, @food, 3, "2026-10-31")
    create_transaction(@book_id, @food, 4, "2026-11-01")
    assert_equal [3, 2], amounts(list_transactions(@book_id, month: "2026-10"))
    assert_equal 4, list_transactions(@book_id).size
  end

  test "month filter handles a leap day" do
    create_transaction(@book_id, @food, 29, "2028-02-29")
    create_transaction(@book_id, @food, 1, "2028-03-01")
    assert_equal [29], amounts(list_transactions(@book_id, month: "2028-02"))
  end

  test "invalid month, sort or amount filter is a bad request" do
    %w[2026-13 2026/10 abc].each do |month|
      get "/api/books/#{@book_id}/transactions", params: { month: month }
      assert_response :bad_request
      get "/api/books/#{@book_id}/summary", params: { month: month }
      assert_response :bad_request
    end
    get "/api/books/#{@book_id}/transactions", params: { sort: "random" }
    assert_response :bad_request
    get "/api/books/#{@book_id}/transactions", params: { minAmount: "many" }
    assert_response :bad_request
  end

  test "search word or tag that is not a string is a bad request" do
    ["q[]=a", "q[x]=a", "tag[]=a", "tag[x]=a"].each do |query|
      get "/api/books/#{@book_id}/transactions?#{query}"
      assert_response :bad_request, query
    end
  end

  test "filters by tag, memo and amount range" do
    create_transaction(@book_id, @food, 500, "2026-10-01", { memo: "コンビニ", tags: ["間食"] })
    create_transaction(@book_id, @food, 3000, "2026-10-02", { memo: "居酒屋", tags: ["外食"] })
    create_transaction(@book_id, @daily, 1500, "2026-10-03", { memo: "ドラッグストア" })
    assert_equal [3000], amounts(list_transactions(@book_id, tag: "外食"))
    assert_equal [500], amounts(list_transactions(@book_id, q: "コンビ"))
    assert_equal [1500], amounts(list_transactions(@book_id, minAmount: 1000, maxAmount: 2000))
    # LIKE の記号はそのままの文字として探す
    assert_equal [], list_transactions(@book_id, q: "%")
  end

  test "sorts by date newest first or by amount" do
    create_transaction(@book_id, @food, 300, "2026-10-05")
    create_transaction(@book_id, @food, 100, "2026-10-20")
    create_transaction(@book_id, @food, 200, "2026-10-10")
    assert_equal [100, 200, 300], amounts(list_transactions(@book_id))
    assert_equal [300, 200, 100], amounts(list_transactions(@book_id, sort: "amount"))
  end

  test "updates, moves and deletes a transaction" do
    id = create_transaction(@book_id, @food, 1000, "2026-10-01", { memo: "メモ" })
    put "/api/transactions/#{id}", params: payload(@daily, 2500, "2026-11-02").merge(memo: ""), as: :json
    assert_response :ok
    assert_equal [2500, "2026-11-02", @daily, nil], json_body.values_at("amount", "date", "categoryId", "memo")

    patch "/api/transactions/#{id}/move", params: { categoryId: @food }, as: :json
    assert_response :ok
    assert_equal [@food, 2500], json_body.values_at("categoryId", "amount")

    delete "/api/transactions/#{id}"
    assert_response :no_content
    get "/api/transactions/#{id}"
    assert_response :not_found
  end

  test "moving to a category of another book is rejected" do
    id = create_transaction(@book_id, @food, 1000, "2026-10-01")
    other_category = categories_of(create_book("別の家計簿"))[1]["id"]
    patch "/api/transactions/#{id}/move", params: { categoryId: other_category }, as: :json
    assert_response :bad_request
  end

  test "another user cannot touch the transactions" do
    id = create_transaction(@book_id, @food, 1000, "2026-10-01")
    other = other_user_session
    other.get "/api/books/#{@book_id}/transactions"
    assert_equal 404, other.response.status
    other.get "/api/books/#{@book_id}/summary", params: { month: "2026-10" }
    assert_equal 404, other.response.status
    other.get "/api/transactions/#{id}"
    assert_equal 404, other.response.status
    other.put "/api/transactions/#{id}", params: payload(@food, 1, "2026-10-01"), as: :json
    assert_equal 404, other.response.status
    other.patch "/api/transactions/#{id}/move", params: { categoryId: @daily }, as: :json
    assert_equal 404, other.response.status
    other.delete "/api/transactions/#{id}"
    assert_equal 404, other.response.status
    other.post "/api/books/#{@book_id}/transactions/bulk-delete", params: { transactionIds: [id] }, as: :json
    assert_equal 404, other.response.status

    get "/api/transactions/#{id}"
    assert_equal 1000, json_body["amount"]
  end

  test "transaction endpoints require login" do
    reset!
    get "/api/books/#{@book_id}/transactions"
    assert_response :unauthorized
    get "/api/books/#{@book_id}/summary", params: { month: "2026-10" }
    assert_response :unauthorized
    post "/api/books/#{@book_id}/transactions", params: payload(@food, 1, "2026-10-01"), as: :json
    assert_response :unauthorized
  end

  test "bulk deletes transactions" do
    a = create_transaction(@book_id, @food, 1, "2026-10-01")
    b = create_transaction(@book_id, @daily, 2, "2026-10-01")
    create_transaction(@book_id, @daily, 3, "2026-10-01")
    post "/api/books/#{@book_id}/transactions/bulk-delete", params: { transactionIds: [a, b] }, as: :json
    assert_response :no_content
    assert_equal [3], amounts(list_transactions(@book_id))
  end

  test "bulk delete with a foreign or unknown id deletes nothing" do
    mine = create_transaction(@book_id, @food, 1, "2026-10-01")
    other_book = create_book("別の家計簿")
    foreign = create_transaction(other_book, categories_of(other_book)[1]["id"], 2, "2026-10-01")
    [[mine, foreign], [mine, "missing"]].each do |ids|
      post "/api/books/#{@book_id}/transactions/bulk-delete", params: { transactionIds: ids }, as: :json
      assert_response :not_found
    end
    assert_equal 1, list_transactions(@book_id).size
    assert_equal 1, list_transactions(other_book).size
  end

  test "summary totals income, expense and balance for the month" do
    create_transaction(@book_id, @salary, 250_000, "2026-10-25")
    create_transaction(@book_id, @food, 1_200, "2026-10-01")
    create_transaction(@book_id, @food, 800, "2026-10-31")
    create_transaction(@book_id, @daily, 3_000, "2026-10-15")
    # 前後の月は含めない
    create_transaction(@book_id, @food, 99_999, "2026-09-30")
    create_transaction(@book_id, @salary, 99_999, "2026-11-01")

    get "/api/books/#{@book_id}/summary", params: { month: "2026-10" }
    assert_response :ok
    assert_equal ["2026-10", 250_000, 5_000, 245_000, 4], json_body.values_at("month", "income", "expense", "balance", "count")
    # 取引の無いカテゴリも0円で、カテゴリの並び順どおりに返す
    categories = json_body["categories"]
    assert_equal 6, categories.size
    assert_equal @salary, categories[0]["categoryId"]
    assert_equal [2_000, 2], categories[1].values_at("total", "count")
    assert_equal 0, categories[3]["total"]
  end

  test "summary balance can be negative and follows the category type" do
    create_transaction(@book_id, @food, 5_000, "2026-10-01")
    get "/api/books/#{@book_id}/summary", params: { month: "2026-10" }
    assert_equal(-5_000, json_body["balance"])

    # カテゴリを収入に変えると、そのカテゴリの取引は収入として集計される
    put "/api/categories/#{@food}", params: { type: "INCOME" }, as: :json
    assert_response :ok
    get "/api/books/#{@book_id}/summary", params: { month: "2026-10" }
    assert_equal [5_000, 0, 5_000], json_body.values_at("income", "expense", "balance")
  end

  test "summary requires a month" do
    get "/api/books/#{@book_id}/summary"
    assert_response :bad_request
  end

  test "unknown API path is not found" do
    get "/api/does-not-exist"
    assert_response :not_found
    get "/api/transactions/some-id/move"
    assert_response :not_found
  end
end
