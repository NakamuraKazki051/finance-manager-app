class BooksController < ApplicationController
  # GET /api/books
  def index
    user_id = current_user_id!
    render json: Book.where(user_id: user_id).order(:created_at, :id).map(&:as_api_json)
  end

  # POST /api/books  {name}。カテゴリが空だと取引を登録できないので、初期カテゴリも一緒に作る
  def create
    user_id = current_user_id!
    name = book_name(params[:name])
    book = Book.transaction do
      Book.create!(user_id: user_id, name: name).tap(&:create_default_categories!)
    end
    render json: book.as_api_json, status: :created
  end

  # POST /api/books/ensure-default
  # 家計簿が1冊も無いユーザーに、初期の家計簿と初期カテゴリを作る。既にあれば何もせず一覧を返す。
  # 初回ログイン時に複数タブや二重送信で同時に呼ばれても、ユーザー行のロックで直列化されるので1冊しか作られない
  def ensure_default
    user_id = current_user_id!
    books = Book.transaction do
      User.lock.find_by(id: user_id) or raise ApiError.unauthorized("ログインしていません")
      existing = Book.where(user_id: user_id).order(:created_at, :id).to_a
      if existing.empty?
        existing = [Book.create!(user_id: user_id, name: Book::DEFAULT_NAME).tap(&:create_default_categories!)]
      end
      existing
    end
    render json: books.map(&:as_api_json)
  end

  # PUT /api/books/:id  {name}
  def update
    user_id = current_user_id!
    book = Book.find_by(id: params[:id], user_id: user_id) or raise ApiError.not_found("家計簿が見つかりません: #{params[:id]}")
    book.update!(name: book_name(params[:name]))
    render json: book.as_api_json
  end

  # DELETE /api/books/:id。カテゴリ・取引も一緒に消す(最後の1冊は消せない)
  def destroy
    user_id = current_user_id!
    Book.transaction do
      # 2つのタブで残り2冊を同時に消しても両方消えないよう、ユーザー行をロックしてから冊数を数える
      User.lock.find_by(id: user_id) or raise ApiError.unauthorized("ログインしていません")
      require_book!(params[:id], user_id)
      raise ApiError.bad_request("最後の1冊の家計簿は削除できません") if Book.where(user_id: user_id).count <= 1

      # カテゴリ・取引・固定費は家計簿への外部キーを持たないため、明示的に消さないとDBに残り続ける
      Entry.where(book_id: params[:id]).delete_all
      RecurringEntry.where(book_id: params[:id]).delete_all
      Category.where(book_id: params[:id]).delete_all
      Book.where(id: params[:id]).delete_all
    end
    head :no_content
  end

  private

  def book_name(value)
    required_string(value, max: 30, blank_message: "家計簿の名前を入力してください",
                           too_long_message: "家計簿の名前は30文字以内で入力してください").strip
  end
end
