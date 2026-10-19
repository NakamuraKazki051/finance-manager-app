class CategoriesController < ApplicationController
  # GET /api/books/:book_id/categories
  def index
    require_book!(params[:book_id], current_user_id!)
    render json: ordered(params[:book_id]).map(&:as_api_json)
  end

  # POST /api/books/:book_id/categories  {name, type, budget?}
  def create
    require_book!(params[:book_id], current_user_id!)
    name = category_name(params[:name])
    kind = category_kind(params[:type])
    category = Category.create!(book_id: params[:book_id], name: name, kind: kind, budget: budget_value(params[:budget]),
                                display_order: Category.where(book_id: params[:book_id]).count)
    render json: category.as_api_json, status: :created
  end

  # PUT /api/categories/:id  {name?, type?, budget?}。budget に null を送ると予算を外す
  # type を変えると、そのカテゴリの取引はすべての月で新しい種別として集計される
  def update
    category = find_owned_category!
    name = optional_string(params[:name], max: 30, too_long_message: "カテゴリ名は30文字以内で入力してください")
    category.name = name.strip if name.present?
    category.kind = category_kind(params[:type]) unless params[:type].nil?
    category.budget = budget_value(params[:budget]) if params.key?(:budget)
    category.save!
    render json: category.as_api_json
  end

  # PATCH /api/categories/:id/move  {displayOrder}
  def move
    category = find_owned_category!
    target = params[:displayOrder]
    raise ApiError.bad_request(MALFORMED_MESSAGE) unless target.is_a?(Integer)

    Category.transaction do
      siblings = ordered(category.book_id).reject { |c| c.id == category.id }
      siblings.insert(target.clamp(0, siblings.size), category)
      renumber(siblings)
    end
    render json: category.reload.as_api_json
  end

  # DELETE /api/categories/:id。そのカテゴリの取引もすべての月の分を削除する(画面で確認してから呼ぶ)
  def destroy
    category = find_owned_category!
    raise ApiError.bad_request("最後の1カテゴリは削除できません") if Category.where(book_id: category.book_id).count <= 1

    Category.transaction do
      Entry.where(category_id: category.id).delete_all
      # そのカテゴリの固定費も消す(残すと、消えたカテゴリの取引を作り続けてしまう)
      RecurringEntry.where(category_id: category.id).delete_all
      category.delete
      renumber(ordered(category.book_id))
    end
    head :no_content
  end

  private

  def ordered(book_id)
    Category.where(book_id: book_id).order(:display_order, :id).to_a
  end

  def renumber(categories)
    categories.each_with_index do |c, i|
      c.update_column(:display_order, i) if c.display_order != i
    end
  end

  def find_owned_category!
    user_id = current_user_id!
    category = Category.find_by(id: params[:id]) or raise ApiError.not_found("カテゴリが見つかりません: #{params[:id]}")
    require_book!(category.book_id, user_id)
    category
  end

  def category_name(value)
    required_string(value, max: 30, blank_message: "カテゴリ名を入力してください",
                           too_long_message: "カテゴリ名は30文字以内で入力してください").strip
  end
end
