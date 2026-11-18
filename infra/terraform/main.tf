# 無料枠に収めるための方針
# - サーバーは EC2 1台、DBは RDS（MySQL）1台。どちらも無料枠の対象のサイズにする
# - VPC は最初からあるデフォルトVPCを使う（NATゲートウェイなど有料の部品を作らない）
# - SSH の鍵もポート22も使わず、ログインは Systems Manager のセッションマネージャーで行う

data "aws_vpc" "default" {
  default = true
}

data "aws_ec2_instance_type" "selected" {
  instance_type = var.instance_type
}

locals {
  arch = contains(data.aws_ec2_instance_type.selected.supported_architectures, "arm64") ? "arm64" : "x86_64"
}

# Amazon Linux 2023 の最新AMI（AWSが公開しているパラメータから取得）
data "aws_ssm_parameter" "al2023_ami" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-${local.arch}"
}

resource "aws_security_group" "app" {
  name        = "${var.project}-app"
  description = "nginx on 80, from CloudFront only. No SSH; use Session Manager."
  vpc_id      = data.aws_vpc.default.id
}

# AWS が管理している CloudFront の送信元 IP の一覧
data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

# 80番（nginx）を CloudFront からだけ開ける。暗号化されない http://<IP>/ を直接開かれないように。
# バックエンド（8080）と SSH（22）は開けない
resource "aws_vpc_security_group_ingress_rule" "app" {
  security_group_id = aws_security_group.app.id
  description       = "http from CloudFront"
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront.id
  from_port         = 80
  to_port           = 80
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.app.id
  description       = "Outbound for package install, Docker images, SSM and RDS"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

# セッションマネージャーで接続するためのロール
resource "aws_iam_role" "ec2" {
  name = "${var.project}-ec2"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# EC2の起動時に、Parameter Store からDBのパスワードを読むための権限（このパラメータだけ）
resource "aws_iam_role_policy" "read_db_password" {
  name = "read-db-password"
  role = aws_iam_role.ec2.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "ssm:GetParameter"
      Resource = aws_ssm_parameter.db_password.arn
    }]
  })
}

resource "aws_iam_instance_profile" "ec2" {
  name = "${var.project}-ec2"
  role = aws_iam_role.ec2.name
}

resource "aws_instance" "app" {
  ami                         = data.aws_ssm_parameter.al2023_ami.value
  instance_type               = var.instance_type
  vpc_security_group_ids      = [aws_security_group.app.id]
  iam_instance_profile        = aws_iam_instance_profile.ec2.name
  associate_public_ip_address = true
  user_data = templatefile("${path.module}/user_data.sh.tftpl", {
    region                = var.region
    db_host               = aws_db_instance.db.address
    db_name               = aws_db_instance.db.db_name
    db_username           = aws_db_instance.db.username
    db_password_parameter = aws_ssm_parameter.db_password.name
    origin_secret         = random_password.origin_secret.result
    app_origin            = "https://${aws_cloudfront_distribution.app.domain_name}"
  })

  # CPUを使いすぎたときに追加料金が出る「unlimited」モードにしない
  credit_specification {
    cpu_credits = "standard"
  }

  # インスタンスメタデータは IMDSv2（トークン必須）だけ許可する
  metadata_options {
    http_tokens   = "required"
    http_endpoint = "enabled"
  }

  root_block_device {
    volume_type = "gp3"
    volume_size = var.root_volume_size
    encrypted   = true
  }

  tags = {
    Name = var.project
  }

  lifecycle {
    # 新しいAMIが出るたびにサーバーが作り直されないようにする
    ignore_changes = [ami, user_data]
  }
}

# 固定のIPアドレス。フロントエンドのURLが、サーバーを止めて起動し直しても変わらないようにする
# EC2に付けている間の料金は、自動で割り当てられるIPと同じ。EC2から外したまま残すと料金だけかかるので注意
resource "aws_eip" "app" {
  domain = "vpc"

  tags = {
    Name = var.project
  }
}

resource "aws_eip_association" "app" {
  instance_id   = aws_instance.app.id
  allocation_id = aws_eip.app.id
}
