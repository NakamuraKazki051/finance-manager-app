class BookExportsController < ApplicationController
  HEADER = %w[日付 種別 カテゴリ 金額 メモ タグ].freeze
  KIND_LABEL = { Category::INCOME => "収入", Category::EXPENSE => "支出" }.freeze
  # Excel が数式として実行してしまう先頭の文字(CSV インジェクション対策)
  FORMULA_PREFIX = /\A[=+\-@\t\r]/

  # GET /api/books/:book_id/export.csv?month=YYYY-MM
  # 取引を Excel で開ける CSV にする。month を省くと全期間。並びは日付の古い順
  def show
    require_book!(params[:book_id], current_user_id!)
    month = month_value(params[:month]) if params[:month].present?

    scope = Entry.where(book_id: params[:book_id]).includes(:category)
    scope = scope.in_month(month) if month
    rows = scope.order(:transaction_date, :created_at, :id).map do |entry|
      [entry.transaction_date.iso8601, KIND_LABEL[entry.category.kind], entry.category.name,
       entry.amount, entry.memo, (entry.tags || []).join(" ")]
    end

    # Excel が UTF-8 と判断できるよう先頭に BOM を付け、改行は CRLF にする
    csv = "﻿" + [HEADER, *rows].map { |row| row.map { |v| csv_field(v) }.join(",") }.join("\r\n") + "\r\n"
    filename = month ? "transactions-#{month.strftime('%Y-%m')}.csv" : "transactions-all.csv"
    send_data csv, type: "text/csv; charset=utf-8", disposition: "attachment", filename: filename
  end

  private

  def csv_field(value)
    return value.to_s if value.is_a?(Integer)
    text = value.to_s
    text = "'#{text}" if text.match?(FORMULA_PREFIX)
    %("#{text.gsub('"', '""')}")
  end
end
