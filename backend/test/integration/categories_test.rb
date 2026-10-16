require "test_helper"

class CategoriesTest < ActionDispatch::IntegrationTest
  setup do
    register_and_login
    @book_id = create_book("家計簿")
  end

  test "creates, lists and updates a category" do
    category_id = create_category(@book_id, "副業", "INCOME")
    categories = categories_of(@book_id)
    assert_equal 7, categories.size
    assert_equal ["副業", "INCOME", 6], categories.last.values_at("name", "type", "displayOrder")

    put "/api/categories/#{category_id}", params: { name: "お小遣い", type: "EXPENSE" }, as: :json
    assert_response :ok
    assert_equal %w[お小遣い EXPENSE], json_body.values_at("name", "type")
  end

  test "rejects missing or unknown type and too long names" do
    post "/api/books/#{@book_id}/categories", params: { name: "種別なし" }, as: :json
    assert_response :bad_request
    post "/api/books/#{@book_id}/categories", params: { name: "x", type: "LOAN" }, as: :json
    assert_response :bad_request
    post "/api/books/#{@book_id}/categories", params: { name: "あ" * 31, type: "EXPENSE" }, as: :json
    assert_response :bad_request
    category_id = categories_of(@book_id)[0]["id"]
    put "/api/categories/#{category_id}", params: { name: "あ" * 300 }, as: :json
    assert_response :bad_request
  end

  test "creating a category for an unknown book is not found" do
    post "/api/books/no-such-book/categories", params: { name: "x", type: "EXPENSE" }, as: :json
    assert_response :not_found
  end

  test "cannot delete the last category" do
    put "/api/books/#{@book_id}/import",
        params: { categories: [{ id: "c1", name: "食費", type: "EXPENSE" }] }, as: :json
    assert_response :no_content
    delete "/api/categories/#{categories_of(@book_id)[0]['id']}"
    assert_response :bad_request
  end

  test "deleting a category deletes its transactions and renumbers the rest" do
    before = categories_of(@book_id)
    food = before[1]["id"]
    daily = before[2]["id"]
    create_transaction(@book_id, food, 800, "2026-10-01")
    create_transaction(@book_id, food, 1200, "2026-09-02")
    kept = create_transaction(@book_id, daily, 300, "2026-10-02")

    delete "/api/categories/#{food}"
    assert_response :no_content
    assert_equal [kept], list_transactions(@book_id).map { |t| t["id"] }
    after = categories_of(@book_id)
    assert_equal 5, after.size
    assert_equal (0..4).to_a, after.map { |c| c["displayOrder"] }
  end

  test "another user cannot list, update, move or delete a category" do
    category_id = categories_of(@book_id)[0]["id"]
    other = other_user_session
    other.get "/api/books/#{@book_id}/categories"
    assert_equal 404, other.response.status
    other.put "/api/categories/#{category_id}", params: { name: "乗っ取り" }, as: :json
    assert_equal 404, other.response.status
    other.patch "/api/categories/#{category_id}/move", params: { displayOrder: 3 }, as: :json
    assert_equal 404, other.response.status
    other.delete "/api/categories/#{category_id}"
    assert_equal 404, other.response.status
    assert_equal "給与", categories_of(@book_id)[0]["name"]
  end

  test "category endpoints require login" do
    reset!
    get "/api/books/any/categories"
    assert_response :unauthorized
    delete "/api/categories/any"
    assert_response :unauthorized
  end

  test "moves a category" do
    last = categories_of(@book_id)[5]["id"]
    patch "/api/categories/#{last}/move", params: { displayOrder: 0 }, as: :json
    assert_response :ok
    after = categories_of(@book_id)
    assert_equal last, after[0]["id"]
    assert_equal "給与", after[1]["name"]
    assert_equal (0..5).to_a, after.map { |c| c["displayOrder"] }
  end
end
