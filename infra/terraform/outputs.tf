output "instance_id" {
  description = "EC2のインスタンスID"
  value       = aws_instance.app.id
}

output "public_ip" {
  description = "EC2のパブリックIP（サーバーを止めて起動し直すと変わる）"
  value       = aws_instance.app.public_ip
}

output "app_url" {
  description = "アプリをデプロイしたあとにブラウザで開くURL"
  value       = "http://${aws_instance.app.public_ip}/"
}

output "connect_command" {
  description = "サーバーに入るコマンド（Session Manager。SSH鍵は不要）"
  value       = "aws ssm start-session --target ${aws_instance.app.id} --region ${var.region}"
}
