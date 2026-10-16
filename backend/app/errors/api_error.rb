# 画面のエラーバナーにそのまま表示する、日本語のメッセージ付きのエラー
class ApiError < StandardError
  attr_reader :status

  def initialize(status, message)
    super(message)
    @status = status
  end

  def self.bad_request(message) = new(400, message)
  def self.unauthorized(message) = new(401, message)
  def self.not_found(message) = new(404, message)
  def self.conflict(message) = new(409, message)
end
