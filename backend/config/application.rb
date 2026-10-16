require_relative "boot"

require "rails"
require "active_model/railtie"
require "active_job/railtie"
require "active_record/railtie"
require "action_controller/railtie"
require "action_view/railtie"
require "rails/test_unit/railtie"

Bundler.require(*Rails.groups)

module FinanceManagerApi
  class Application < Rails::Application
    config.load_defaults 8.1
    config.autoload_lib(ignore: %w[assets tasks])

    # 画面は Next.js の静的ファイル(frontend/)で、Rails は /api/ の JSON だけを返す
    config.api_only = true

    config.time_zone = "Tokyo"

    # API モードでは Cookie とセッションが外されているので戻す。
    # 画面と API は同じオリジン(EC2 では nginx、ローカルでは Rails が静的ファイルも配信)なので、SameSite=Lax で十分守れる
    config.session_store :cookie_store, key: "_finance_manager_session", same_site: :lax, httponly: true
    config.middleware.use ActionDispatch::Cookies
    config.middleware.use config.session_store, config.session_options
  end
end
