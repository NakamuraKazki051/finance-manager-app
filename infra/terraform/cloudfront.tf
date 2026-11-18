# ブラウザとの間を HTTPS にする。証明書は CloudFront の標準のもの（xxxx.cloudfront.net）なので、独自ドメインは要らない
# CloudFront〜EC2 の間は HTTP のまま（EC2 に証明書が無いため）。80番は CloudFront からしか入れない（main.tf）

# AWS が用意している設定。ID は AWS の全アカウントで共通
locals {
  cache_policy_caching_disabled   = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
  origin_request_policy_all       = "216adef6-5c7f-47e4-b989-5492eafa07d3"
  response_headers_policy_default = "67f7725c-6f97-4210-82d7-5512b31e9d03"
}

# 自分の CloudFront を通ったことの証明。80番は他人の CloudFront からも届くので、nginx がこの値を確かめる（user_data.sh.tftpl）
# CloudFront の設定に必要なので state に残る（環境を作り直すたびに変わる）
resource "random_password" "origin_secret" {
  length  = 40
  special = false
}

resource "aws_cloudfront_distribution" "app" {
  enabled         = true
  comment         = var.project
  is_ipv6_enabled = false
  # 日本のエッジを含む中で、いちばん範囲の狭いクラス
  price_class = "PriceClass_200"

  origin {
    origin_id = "app"
    # CloudFront の接続先に IP は指定できないので、Elastic IP の DNS 名を使う
    domain_name = aws_eip.app.public_dns

    custom_header {
      name  = "X-Origin-Verify"
      value = random_password.origin_secret.result
    }

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id = "app"
    # http で来たら https へ移す
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods         = ["GET", "HEAD"]

    # 人によって中身が変わる API を混ぜないよう、キャッシュしない。Cookie もヘッダーもそのまま nginx へ渡す
    cache_policy_id          = local.cache_policy_caching_disabled
    origin_request_policy_id = local.origin_request_policy_all
    # HSTS（ブラウザに https だけを使わせる）など
    response_headers_policy_id = local.response_headers_policy_default
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}
