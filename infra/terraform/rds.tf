# RDS（PostgreSQL）。無料枠の範囲：db.t4g.micro / シングルAZ / ストレージ20GB
# インターネットからは接続できず、アプリのEC2からだけ 5432番で接続できる

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

resource "aws_db_subnet_group" "db" {
  name       = "${var.project}-db"
  subnet_ids = data.aws_subnets.default.ids
}

resource "aws_security_group" "db" {
  name        = "${var.project}-db"
  description = "PostgreSQL from the app EC2 only"
  vpc_id      = data.aws_vpc.default.id
}

resource "aws_vpc_security_group_ingress_rule" "db_from_app" {
  security_group_id            = aws_security_group.db.id
  description                  = "PostgreSQL from app EC2"
  referenced_security_group_id = aws_security_group.app.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
}

# パスワードは apply の間だけ作られ、state にもGitにも残らない（ephemeral + write-only）
ephemeral "random_password" "db" {
  length  = 32
  special = false
}

# EC2が起動時に読むための保管場所。Parameter Store の標準パラメータは無料
# （Secrets Manager は1つあたり月0.4ドルかかるので使わない）
resource "aws_ssm_parameter" "db_password" {
  name             = "/${var.project}/db/password"
  type             = "SecureString"
  value_wo         = ephemeral.random_password.db.result
  value_wo_version = var.db_password_version
}

resource "aws_db_instance" "db" {
  identifier     = "${var.project}-db"
  engine         = "postgres"
  engine_version = "16"
  instance_class = var.db_instance_class

  allocated_storage = 20
  storage_type      = "gp2"
  storage_encrypted = true

  db_name             = "taskmanager"
  username            = "taskmanager"
  password_wo         = ephemeral.random_password.db.result
  password_wo_version = var.db_password_version

  db_subnet_group_name   = aws_db_subnet_group.db.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false
  multi_az               = false

  # 自動バックアップは1日分だけ（無料枠のバックアップ容量 20GB に収める）
  backup_retention_period = 1

  # 有料になりうる監視機能は使わない
  performance_insights_enabled = false
  monitoring_interval          = 0

  auto_minor_version_upgrade = true
  apply_immediately          = true

  # terraform destroy でDBごと消える。消す前に、アプリの「エクスポート」でデータを書き出しておくこと
  skip_final_snapshot = true
  deletion_protection = false
}
