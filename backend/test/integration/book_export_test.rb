require "test_helper"

class BookExportTest < ActionDispatch::IntegrationTest
  setup do
    register_and_login
    @book_id = create_book("家計簿")
    categories = categories_of(@book_id)
    @salary, @food = categories[0..1].map { |c| c["id"] }
  end

  def export(query = {})
    get "/api/books/#{@book_id}/export.csv", params: query
  end

  # BOM を外して行ごとに分ける
  def csv_lines
    body = response.body.dup.force_encoding("UTF-8")
    assert body.start_with?("﻿"), "BOM がない"
    body.delete_prefix("﻿").split("\r\n")
  end

  test "exports the month as an Excel-friendly CSV in date order" do
    create_transaction(@book_id, @food, 1280, "2026-10-17", { memo: "スーパー", tags: %w[日常 現金] })
    create_transaction(@book_id, @salary, 250_000, "2026-10-01", { memo: "給料" })
    create_transaction(@book_id, @food, 500, "2026-09-30")
    create_transaction(@book_id, @food, 600, "2026-11-01")

    export(month: "2026-10")
    assert_response :ok
    assert_equal "text/csv; charset=utf-8", response.media_type + "; charset=" + response.charset
    assert_match(/attachment; filename="transactions-2026-10\.csv"/, response.headers["Content-Disposition"])
    assert response.body.end_with?("\r\n")
    assert_equal [
      %("日付","種別","カテゴリ","金額","メモ","タグ"),
      %("2026-10-01","収入","給与",250000,"給料",""),
      %("2026-10-17","支出","食費",1280,"スーパー","日常 現金")
    ], csv_lines
  end

  test "exports every month when month is omitted" do
    create_transaction(@book_id, @food, 1, "2025-12-31")
    create_transaction(@book_id, @food, 2, "2026-10-01")
    export
    assert_response :ok
    assert_match(/filename="transactions-all\.csv"/, response.headers["Content-Disposition"])
    assert_equal 3, csv_lines.size
  end

  test "an empty month still has the header" do
    export(month: "2026-10")
    assert_response :ok
    assert_equal [%("日付","種別","カテゴリ","金額","メモ","タグ")], csv_lines
  end

  test "quotes commas, quotes and line breaks, and defuses formulas" do
    create_transaction(@book_id, @food, 100, "2026-10-01", { memo: %(A,"B") })
    create_transaction(@book_id, @food, 200, "2026-10-02", { memo: "=1+1" })
    create_transaction(@book_id, @food, 300, "2026-10-03", { memo: "-2", tags: ["@x"] })
    export(month: "2026-10")
    lines = csv_lines
    assert_equal %("2026-10-01","支出","食費",100,"A,""B""",""), lines[1]
    assert_equal %("2026-10-02","支出","食費",200,"'=1+1",""), lines[2]
    assert_equal %("2026-10-03","支出","食費",300,"'-2","'@x"), lines[3]
  end

  test "rejects a malformed month" do
    export(month: "2026-13")
    assert_response :bad_request
  end

  test "requires login and hides other users' books" do
    other = other_user_session
    other.get "/api/books/#{@book_id}/export.csv"
    assert_equal 404, other.response.status

    post "/api/auth/logout"
    export
    assert_response :unauthorized
  end
end
