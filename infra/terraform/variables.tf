variable "region" {
  description = "作成先のリージョン"
  type        = string
  default     = "ap-northeast-1"
}

variable "project" {
  description = "リソース名とタグに付ける名前"
  type        = string
  default     = "task-manager-app"
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
  description = "フロントエンド（80番）とバックエンド（8080番）にアクセスを許可するIPの範囲。自分だけに絞るなら [\"<自分のIP>/32\"]"
  type        = list(string)
  default     = ["0.0.0.0/0"]
}
