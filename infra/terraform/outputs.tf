output "instance_id" {
  description = "EC2のインスタンスID"
  value       = aws_instance.app.id
}

output "public_ip" {
  description = "EC2の固定IP（Elastic IP）"
  value       = aws_eip.app.public_ip
}

output "frontend_url" {
  description = "フロントエンド（80番）。ブラウザで開くURL"
  value       = "http://${aws_eip.app.public_ip}/"
}

output "backend_url" {
  description = "バックエンドAPI（8080番）"
  value       = "http://${aws_eip.app.public_ip}:8080/"
}

output "connect_command" {
  description = "サーバーに入るコマンド（Session Manager。SSH鍵は不要）"
  value       = "aws ssm start-session --target ${aws_instance.app.id} --region ${var.region}"
}
