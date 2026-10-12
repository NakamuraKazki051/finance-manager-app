output "instance_id" {
  description = "EC2のインスタンスID"
  value       = aws_instance.app.id
}

output "public_ip" {
  description = "EC2の固定IP（Elastic IP）"
  value       = aws_eip.app.public_ip
}

output "app_url" {
  description = "ブラウザで開くURL（nginx、80番）"
  value       = "http://${aws_eip.app.public_ip}/"
}

output "db_endpoint" {
  description = "RDSの接続先。EC2の中からだけ接続できる"
  value       = aws_db_instance.db.address
}

output "artifacts_bucket" {
  description = "デプロイするファイルを置くS3バケット（deploy.ps1 が使う）"
  value       = aws_s3_bucket.artifacts.bucket
}

output "connect_command" {
  description = "サーバーに入るコマンド（Session Manager。SSH鍵は不要）"
  value       = "aws ssm start-session --target ${aws_instance.app.id} --region ${var.region}"
}
