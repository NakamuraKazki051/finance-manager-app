# This file is auto-generated from the current state of the database. Instead
# of editing this file, please use the migrations feature of Active Record to
# incrementally modify your database, and then regenerate this schema definition.
#
# This file is the source Rails uses to define your schema when running `bin/rails
# db:schema:load`. When creating a new database, `bin/rails db:schema:load` tends to
# be faster and is potentially less error prone than running all of your
# migrations from scratch. Old migrations may fail to apply correctly if those
# migrations use external dependencies or application code.
#
# It's strongly recommended that you check this file into your version control system.

ActiveRecord::Schema[8.1].define(version: 2026_10_19_000002) do
  create_table "books", id: { type: :string, limit: 36 }, charset: "utf8mb4", collation: "utf8mb4_0900_ai_ci", force: :cascade do |t|
    t.string "user_id", limit: 36, null: false
    t.string "name", limit: 30, null: false
    t.datetime "created_at", null: false
    t.index ["user_id", "created_at"], name: "index_books_on_user_id_and_created_at"
  end

  create_table "categories", id: { type: :string, limit: 36 }, charset: "utf8mb4", collation: "utf8mb4_0900_ai_ci", force: :cascade do |t|
    t.string "book_id", limit: 36, null: false
    t.string "name", limit: 30, null: false
    t.string "kind", limit: 10, null: false
    t.integer "display_order", default: 0, null: false
    t.bigint "budget"
    t.index ["book_id", "display_order"], name: "index_categories_on_book_id_and_display_order"
  end

  create_table "entries", id: { type: :string, limit: 36 }, charset: "utf8mb4", collation: "utf8mb4_0900_ai_ci", force: :cascade do |t|
    t.string "book_id", limit: 36, null: false
    t.string "category_id", limit: 36, null: false
    t.bigint "amount", null: false
    t.date "transaction_date", null: false
    t.string "memo", limit: 100
    t.json "tags", null: false
    t.datetime "created_at", null: false
    t.boolean "confirmed", default: true, null: false
    t.string "recurring_entry_id", limit: 36
    t.index ["book_id", "transaction_date"], name: "index_entries_on_book_id_and_transaction_date"
    t.index ["category_id"], name: "index_entries_on_category_id"
  end

  create_table "recurring_entries", id: { type: :string, limit: 36 }, charset: "utf8mb4", collation: "utf8mb4_0900_ai_ci", force: :cascade do |t|
    t.string "book_id", limit: 36, null: false
    t.string "category_id", limit: 36, null: false
    t.bigint "amount", null: false
    t.integer "day_of_month", null: false
    t.string "memo", limit: 100
    t.json "tags", null: false
    t.date "start_month", null: false
    t.date "last_generated_month"
    t.datetime "created_at", null: false
    t.index ["book_id"], name: "index_recurring_entries_on_book_id"
    t.index ["category_id"], name: "index_recurring_entries_on_category_id"
  end

  create_table "users", id: { type: :string, limit: 36 }, charset: "utf8mb4", collation: "utf8mb4_0900_ai_ci", force: :cascade do |t|
    t.string "email", null: false
    t.string "password_digest", null: false
    t.datetime "created_at", null: false
    t.index ["email"], name: "index_users_on_email", unique: true
  end
end
