# デプロイするファイル（app.jar とフロントエンド）の受け渡し場所。
# deploy.ps1 がここに置き、EC2 が取りに行く。インターネットには公開しない
# 中身はビルドしたファイルだけなので、down.ps1 で環境ごと消してよい（force_destroy）

data "aws_caller_identity" "current" {}

resource "aws_s3_bucket" "artifacts" {
  bucket        = "${var.project}-artifacts-${data.aws_caller_identity.current.account_id}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "artifacts" {
  bucket                  = aws_s3_bucket.artifacts.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# EC2 がこのバケットの中身を読むための権限（読むだけ）
resource "aws_iam_role_policy" "read_artifacts" {
  name = "read-artifacts"
  role = aws_iam_role.ec2.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "s3:GetObject"
      Resource = "${aws_s3_bucket.artifacts.arn}/*"
    }]
  })
}
