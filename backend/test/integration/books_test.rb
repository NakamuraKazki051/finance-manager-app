require "test_helper"

class BooksTest < ActionDispatch::IntegrationTest
  setup { register_and_login }

  test "requires login" do
    reset!
    get "/api/books"
    assert_response :unauthorized
    post "/api/books", params: { name: "x" }, as: :json
    assert_response :unauthorized
    post "/api/books/ensure-default"
    assert_response :unauthorized
  end

  test "a created book has the default categories" do
    book_id = create_book("生活費")
    get "/api/books"
    assert_equal [{ "id" => book_id, "name" => "生活費" }], json_body

    categories = categories_of(book_id)
    assert_equal %w[給与 食費 日用品 交通費 住居・光熱費 その他], categories.map { |c| c["name"] }
    assert_equal "INCOME", categories[0]["type"]
    assert_equal %w[EXPENSE] * 5, categories[1..].map { |c| c["type"] }
    assert_equal (0..5).to_a, categories.map { |c| c["displayOrder"] }
  end

  test "users only see and change their own books" do
    book_id = create_book("自分の家計簿")
    create_book("予備")
    other = other_user_session
    other.get "/api/books"
    assert_equal [], json_body(other)
    other.put "/api/books/#{book_id}", params: { name: "乗っ取り" }, as: :json
    assert_equal 404, other.response.status
    other.delete "/api/books/#{book_id}"
    assert_equal 404, other.response.status
  end

  test "rejects blank and too long names" do
    post "/api/books", params: { name: " " }, as: :json
    assert_response :bad_request
    post "/api/books", params: { name: "あ" * 31 }, as: :json
    assert_response :bad_request
    book_id = create_book("家計簿")
    put "/api/books/#{book_id}", params: { name: "あ" * 300 }, as: :json
    assert_response :bad_request
  end

  test "renames a book" do
    book_id = create_book("旧名")
    put "/api/books/#{book_id}", params: { name: " 新名 " }, as: :json
    assert_response :ok
    assert_equal "新名", json_body["name"]
  end

  test "deletes a book unless it is the last one, together with its categories and transactions" do
    book_id = create_book("消す家計簿")
    delete "/api/books/#{book_id}"
    assert_response :bad_request

    create_book("残す家計簿")
    food = categories_of(book_id)[1]["id"]
    create_transaction(book_id, food, 500, "2026-10-01")
    delete "/api/books/#{book_id}"
    assert_response :no_content
    assert_equal 0, Category.where(book_id: book_id).count
    assert_equal 0, Entry.where(book_id: book_id).count
  end

  test "ensure-default creates one book with default categories only once" do
    post "/api/books/ensure-default"
    assert_response :ok
    assert_equal 1, json_body.size
    assert_equal "家計簿", json_body[0]["name"]
    book_id = json_body[0]["id"]
    assert_equal 6, categories_of(book_id).size

    post "/api/books/ensure-default"
    assert_equal [book_id], json_body.map { |b| b["id"] }
    assert_equal 6, categories_of(book_id).size
  end

  test "ensure-default leaves existing books alone" do
    create_book("既存")
    post "/api/books/ensure-default"
    assert_equal ["既存"], json_body.map { |b| b["name"] }
  end

  test "unknown book is not found" do
    delete "/api/books/no-such-book"
    assert_response :not_found
  end
end
