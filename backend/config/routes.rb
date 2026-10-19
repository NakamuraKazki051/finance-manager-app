Rails.application.routes.draw do
  # 起動確認用(EC2 のデプロイスクリプトが使う)
  get "up" => "rails/health#show", as: :rails_health_check

  scope "/api", defaults: { format: :json } do
    post "users/register", to: "users#register"
    put "users/me", to: "users#update_me"

    post "auth/login", to: "auth#login"
    post "auth/logout", to: "auth#logout"
    get "auth/me", to: "auth#me"

    post "books/ensure-default", to: "books#ensure_default"
    resources :books, only: %i[index create update destroy] do
      resources :categories, only: %i[index create]
      resources :transactions, only: %i[index create]
      post "transactions/bulk-delete", to: "transactions#bulk_delete"
      resources :recurring_transactions, path: "recurring-transactions", only: %i[index create]
      post "recurring-transactions/generate", to: "recurring_transactions#generate"
      get "summary", to: "summaries#show"
      get "summary/monthly", to: "summaries#monthly"
      put "import", to: "book_imports#update"
      get "export.csv", to: "book_exports#show", format: false
    end

    resources :categories, only: %i[update destroy] do
      patch "move", on: :member
    end
    resources :transactions, only: %i[show update destroy] do
      patch "move", on: :member
      patch "confirm", on: :member
    end
    resources :recurring_transactions, path: "recurring-transactions", only: %i[update destroy]

    match "*path", to: "application#route_not_found", via: :all
  end
end
