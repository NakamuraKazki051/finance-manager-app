variable "region" {
  description = "作成先のリージョン"
  type        = string
  default     = "ap-northeast-1"
}

variable "project" {
  description = "リソース名とタグに付ける名前"
  type        = string
  default     = "finance-manager-app"
}

variable "instance_type" {
  description = "EC2のインスタンスタイプ。無料枠の対象（t3.micro / t4g.micro など）から選ぶ"
  type        = string
  default     = "t3.micro"
}

variable "root_volume_size" {
  description = "ディスク容量（GB）。無料枠は合計30GBまで"
  type        = number
  default     = 20

  validation {
    condition     = var.root_volume_size >= 8 && var.root_volume_size <= 30
    error_message = "無料枠に収めるため、8〜30GBの範囲で指定してください。"
  }
}

variable "allowed_http_cidrs" {
  description = "アプリにアクセスを許可するIPの範囲。自分だけに絞るなら [\"<自分のIP>/32\"]"
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "expose_backend_port" {
  description = "バックエンド（8080番）もインターネットに直接開けるか。普段は nginx（80番）経由で使うので閉じておく"
  type        = bool
  default     = false
}

variable "db_instance_class" {
  description = "RDSのインスタンスクラス。無料枠の対象（db.t4g.micro / db.t3.micro）から選ぶ"
  type        = string
  default     = "db.t4g.micro"
}

variable "db_snapshot_identifier" {
  description = "RDSをこのスナップショットから復元して作る（up.ps1 が最新のものを自動で指定する）。null なら空のDBを作る"
  type        = string
  default     = null
}

variable "db_password_version" {
  description = "DBのパスワードを作り直したいときに1つ増やす（apply すると新しいパスワードに変わる）"
  type        = number
  default     = 1
}
