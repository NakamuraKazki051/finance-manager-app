require "test_helper"

class BookImportTest < ActionDispatch::IntegrationTest
  setup do
    register_and_login
    @book_id = create_book("家計簿")
  end

  def sample_backup
    {
      categories: [
        { id: "old-income", name: "給与", type: "INCOME" },
        { id: "old-food", name: "食費", type: "EXPENSE" }
      ],
      transactions: [
        { categoryId: "old-income", amount: 250_000, date: "2026-10-25", memo: "10月分" },
        { categoryId: "old-food", amount: 1200, date: "2026-10-03", tags: ["外食"] }
      ]
    }
  end

  test "replaces the categories and transactions of a book" do
    old_category = categories_of(@book_id)[1]["id"]
    create_transaction(@book_id, old_category, 999, "2026-10-01")

    put "/api/books/#{@book_id}/import", params: sample_backup, as: :json
    assert_response :no_content

    categories = categories_of(@book_id)
    assert_equal %w[給与 食費], categories.map { |c| c["name"] }
    transactions = list_transactions(@book_id)
    assert_equal [250_000, 1200], amounts(transactions)
    # カテゴリIDは新しく振り直され、取引はそちらを指す
    assert_equal categories[0]["id"], transactions[0]["categoryId"]
    assert_equal ["外食"], transactions[1]["tags"]
  end

  test "an invalid row changes nothing" do
    invalid_backups = [
      { categories: [{ id: "c1", name: "食費", type: "EXPENSE" }],
        transactions: [{ categoryId: "missing", amount: 100, date: "2026-10-01" }] },
      { categories: [{ id: "c1", name: "食費", type: "EXPENSE" }],
        transactions: [{ categoryId: "c1", amount: 0, date: "2026-10-01" }] },
      { categories: [{ id: "c1", name: "食費", type: "EXPENSE" }],
        transactions: [{ categoryId: "c1", date: "2026-10-01" }] },
      { categories: [{ id: "c1", name: "食費", type: "EXPENSE" }],
        transactions: [{ categoryId: "c1", amount: 1, date: "2026-10-01", memo: "あ" * 300 }] },
      { categories: [{ id: "c1", name: "食費" }] },
      { categories: [{ id: "c1", type: "EXPENSE" }] },
      { categories: [] }
    ]
    invalid_backups.each do |backup|
      put "/api/books/#{@book_id}/import", params: backup, as: :json
      assert_response :bad_request, backup.inspect
    end
    assert_equal 6, categories_of(@book_id).size
  end

  test "unknown or another user's book is not found" do
    put "/api/books/no-such-book/import", params: sample_backup, as: :json
    assert_response :not_found

    other = other_user_session
    other.put "/api/books/#{@book_id}/import", params: sample_backup, as: :json
    assert_equal 404, other.response.status
    assert_equal 6, categories_of(@book_id).size
  end
end
