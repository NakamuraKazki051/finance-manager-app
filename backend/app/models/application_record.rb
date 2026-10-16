class ApplicationRecord < ActiveRecord::Base
  primary_abstract_class

  # 主キーは UUID の文字列。保存前に振る
  before_create { self.id ||= SecureRandom.uuid }
end
