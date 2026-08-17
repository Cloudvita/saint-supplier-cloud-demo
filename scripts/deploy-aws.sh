#!/usr/bin/env bash
# =============================================================================
# SAINT Supplier Management — one-shot AWS deployment
#
# Creates: VPC + subnets + NAT/endpoints, RDS PostgreSQL, S3 bucket, Secrets,
#          IAM roles, ECR repo + image, App Runner VPC connector and service.
#
# Idempotent: every resource is checked before it is created, so you can re-run
# this after a failure and it will pick up where it stopped.
#
# Usage:
#   ./scripts/deploy-aws.sh                 # deploy (or update) everything
#   NETWORK_MODE=endpoints ./scripts/deploy-aws.sh
#   AWS_REGION=us-west-2 ./scripts/deploy-aws.sh
#
# Teardown:  ./scripts/teardown-aws.sh
# =============================================================================
set -Eeuo pipefail

# ----------------------------- configuration ---------------------------------
PROJECT="${PROJECT:-saint-supplier-management}"
AWS_REGION="${AWS_REGION:-us-east-1}"
DB_INSTANCE_CLASS="${DB_INSTANCE_CLASS:-db.t4g.micro}"
DB_NAME="${DB_NAME:-saint}"
DB_USER="${DB_USER:-saintadmin}"
APP_CPU="${APP_CPU:-0.5 vCPU}"
APP_MEMORY="${APP_MEMORY:-1 GB}"

# nat       = NAT gateway, ~$33/mo, everything works (Textract, SES, news APIs)
# endpoints = no NAT, ~$8/mo, Textract + S3 only. SES and external news APIs
#             will NOT be reachable (alerts log instead of send, news stays mock).
NETWORK_MODE="${NETWORK_MODE:-nat}"

ALERT_FROM_EMAIL="${ALERT_FROM_EMAIL:-}"
DEFAULT_PROCUREMENT_MANAGER_EMAIL="${DEFAULT_PROCUREMENT_MANAGER_EMAIL:-}"
NEWS_PROVIDER="${NEWS_PROVIDER:-mock}"

# ----------------------------- helpers ---------------------------------------
BOLD=$'\033[1m'; DIM=$'\033[2m'; GRN=$'\033[32m'; YLW=$'\033[33m'; RED=$'\033[31m'; RST=$'\033[0m'
step()  { echo; echo "${BOLD}▸ $*${RST}"; }
ok()    { echo "  ${GRN}✓${RST} $*"; }
info()  { echo "  ${DIM}·${RST} $*"; }
warn()  { echo "  ${YLW}!${RST} $*"; }
die()   { echo "${RED}✗ $*${RST}" >&2; exit 1; }

STATE_FILE=".aws-deploy-state"
save() { grep -v "^$1=" "$STATE_FILE" 2>/dev/null > "$STATE_FILE.tmp" || true
         mv -f "$STATE_FILE.tmp" "$STATE_FILE" 2>/dev/null || true
         echo "$1=$2" >> "$STATE_FILE"; }
touch "$STATE_FILE"

aws_() { aws --region "$AWS_REGION" "$@"; }

trap 'echo; die "Failed at line $LINENO. Fix the error above and re-run — the script resumes."' ERR

# ============================ 0. preflight ===================================
step "Preflight"

command -v aws    >/dev/null || die "AWS CLI not found. Install AWS CLI v2 first."
command -v docker >/dev/null || die "Docker not found. Install Docker Desktop and start it."
docker info >/dev/null 2>&1  || die "Docker daemon is not running. Start Docker Desktop."

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text 2>/dev/null)" \
  || die "AWS CLI is not configured. Run: aws configure"

CALLER="$(aws sts get-caller-identity --query Arn --output text)"
ok "AWS account ${ACCOUNT_ID} in ${AWS_REGION}"
info "identity: ${CALLER}"
info "network mode: ${NETWORK_MODE}"
[ "$NETWORK_MODE" = "endpoints" ] && warn "endpoints mode: SES email and external news APIs will be unreachable"

# ============================ 1. networking ==================================
step "1/10  VPC and subnets"

VPC_ID="$(aws_ ec2 describe-vpcs --filters "Name=tag:Name,Values=${PROJECT}-vpc" \
  --query 'Vpcs[0].VpcId' --output text)"

if [ "$VPC_ID" = "None" ] || [ -z "$VPC_ID" ]; then
  VPC_ID="$(aws_ ec2 create-vpc --cidr-block 10.20.0.0/16 \
    --tag-specifications "ResourceType=vpc,Tags=[{Key=Name,Value=${PROJECT}-vpc}]" \
    --query 'Vpc.VpcId' --output text)"
  aws_ ec2 modify-vpc-attribute --vpc-id "$VPC_ID" --enable-dns-hostnames
  aws_ ec2 modify-vpc-attribute --vpc-id "$VPC_ID" --enable-dns-support
  ok "created VPC ${VPC_ID}"
else
  ok "VPC ${VPC_ID} already exists"
fi
save VPC_ID "$VPC_ID"

read -r AZ1 AZ2 <<<"$(aws_ ec2 describe-availability-zones \
  --query 'AvailabilityZones[?State==`available`].ZoneName | [0:2]' --output text)"
info "availability zones: ${AZ1}, ${AZ2}"

subnet_id() {  # name -> id or empty
  local id; id="$(aws_ ec2 describe-subnets --filters "Name=tag:Name,Values=$1" \
    "Name=vpc-id,Values=${VPC_ID}" --query 'Subnets[0].SubnetId' --output text)"
  [ "$id" = "None" ] && echo "" || echo "$id"
}
make_subnet() {  # name cidr az  -> id
  local id; id="$(subnet_id "$1")"
  if [ -z "$id" ]; then
    id="$(aws_ ec2 create-subnet --vpc-id "$VPC_ID" --cidr-block "$2" --availability-zone "$3" \
      --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=$1}]" \
      --query 'Subnet.SubnetId' --output text)"
  fi
  echo "$id"
}

PUBLIC_SUBNET="$(make_subnet "${PROJECT}-public-a" 10.20.0.0/24 "$AZ1")"
PRIVATE_SUBNET_A="$(make_subnet "${PROJECT}-private-a" 10.20.10.0/24 "$AZ1")"
PRIVATE_SUBNET_B="$(make_subnet "${PROJECT}-private-b" 10.20.11.0/24 "$AZ2")"
ok "subnets: public ${PUBLIC_SUBNET} | private ${PRIVATE_SUBNET_A}, ${PRIVATE_SUBNET_B}"
save PUBLIC_SUBNET "$PUBLIC_SUBNET"
save PRIVATE_SUBNET_A "$PRIVATE_SUBNET_A"
save PRIVATE_SUBNET_B "$PRIVATE_SUBNET_B"

# --- internet gateway + public route table ---
IGW_ID="$(aws_ ec2 describe-internet-gateways --filters "Name=attachment.vpc-id,Values=${VPC_ID}" \
  --query 'InternetGateways[0].InternetGatewayId' --output text)"
if [ "$IGW_ID" = "None" ]; then
  IGW_ID="$(aws_ ec2 create-internet-gateway \
    --tag-specifications "ResourceType=internet-gateway,Tags=[{Key=Name,Value=${PROJECT}-igw}]" \
    --query 'InternetGateway.InternetGatewayId' --output text)"
  aws_ ec2 attach-internet-gateway --internet-gateway-id "$IGW_ID" --vpc-id "$VPC_ID"
  ok "created internet gateway ${IGW_ID}"
else
  ok "internet gateway ${IGW_ID} already attached"
fi
save IGW_ID "$IGW_ID"

route_table() {  # name -> id (create if missing)
  local id; id="$(aws_ ec2 describe-route-tables --filters "Name=tag:Name,Values=$1" \
    "Name=vpc-id,Values=${VPC_ID}" --query 'RouteTables[0].RouteTableId' --output text)"
  if [ "$id" = "None" ]; then
    id="$(aws_ ec2 create-route-table --vpc-id "$VPC_ID" \
      --tag-specifications "ResourceType=route-table,Tags=[{Key=Name,Value=$1}]" \
      --query 'RouteTable.RouteTableId' --output text)"
  fi
  echo "$id"
}

PUBLIC_RT="$(route_table "${PROJECT}-public-rt")"
aws_ ec2 create-route --route-table-id "$PUBLIC_RT" --destination-cidr-block 0.0.0.0/0 \
  --gateway-id "$IGW_ID" >/dev/null 2>&1 || true
aws_ ec2 associate-route-table --route-table-id "$PUBLIC_RT" --subnet-id "$PUBLIC_SUBNET" >/dev/null 2>&1 || true

PRIVATE_RT="$(route_table "${PROJECT}-private-rt")"
for s in "$PRIVATE_SUBNET_A" "$PRIVATE_SUBNET_B"; do
  aws_ ec2 associate-route-table --route-table-id "$PRIVATE_RT" --subnet-id "$s" >/dev/null 2>&1 || true
done
save PRIVATE_RT "$PRIVATE_RT"

# ============================ 2. egress ======================================
step "2/10  Outbound connectivity (${NETWORK_MODE})"

if [ "$NETWORK_MODE" = "nat" ]; then
  NAT_ID="$(aws_ ec2 describe-nat-gateways \
    --filter "Name=tag:Name,Values=${PROJECT}-nat" "Name=state,Values=available,pending" \
    --query 'NatGateways[0].NatGatewayId' --output text)"
  if [ "$NAT_ID" = "None" ] || [ -z "$NAT_ID" ]; then
    EIP_ALLOC="$(aws_ ec2 allocate-address --domain vpc \
      --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=${PROJECT}-nat-eip}]" \
      --query AllocationId --output text)"
    NAT_ID="$(aws_ ec2 create-nat-gateway --subnet-id "$PUBLIC_SUBNET" --allocation-id "$EIP_ALLOC" \
      --tag-specifications "ResourceType=natgateway,Tags=[{Key=Name,Value=${PROJECT}-nat}]" \
      --query 'NatGateway.NatGatewayId' --output text)"
    info "waiting for NAT gateway (about 2 minutes)…"
    aws_ ec2 wait nat-gateway-available --nat-gateway-ids "$NAT_ID"
    ok "created NAT gateway ${NAT_ID}"
  else
    ok "NAT gateway ${NAT_ID} already exists"
  fi
  aws_ ec2 create-route --route-table-id "$PRIVATE_RT" --destination-cidr-block 0.0.0.0/0 \
    --nat-gateway-id "$NAT_ID" >/dev/null 2>&1 || true
  save NAT_ID "$NAT_ID"
  warn "NAT gateway costs roughly \$33/month — run ./scripts/teardown-aws.sh when you are done testing"
else
  # S3 gateway endpoint is free; Textract needs an interface endpoint.
  aws_ ec2 create-vpc-endpoint --vpc-id "$VPC_ID" \
    --service-name "com.amazonaws.${AWS_REGION}.s3" \
    --route-table-ids "$PRIVATE_RT" >/dev/null 2>&1 && ok "created S3 gateway endpoint" \
    || info "S3 gateway endpoint already present"
  ok "S3 + Textract reachable without NAT; SES and public news APIs are not"
fi

# ============================ 3. security groups =============================
step "3/10  Security groups"

sg_id() {
  local id; id="$(aws_ ec2 describe-security-groups --filters "Name=group-name,Values=$1" \
    "Name=vpc-id,Values=${VPC_ID}" --query 'SecurityGroups[0].GroupId' --output text)"
  [ "$id" = "None" ] && echo "" || echo "$id"
}

APP_SG="$(sg_id "${PROJECT}-apprunner-sg")"
if [ -z "$APP_SG" ]; then
  APP_SG="$(aws_ ec2 create-security-group --group-name "${PROJECT}-apprunner-sg" \
    --description "App Runner VPC connector egress" --vpc-id "$VPC_ID" \
    --query GroupId --output text)"
  ok "created App Runner SG ${APP_SG}"
else
  ok "App Runner SG ${APP_SG} already exists"
fi

DB_SG="$(sg_id "${PROJECT}-rds-sg")"
if [ -z "$DB_SG" ]; then
  DB_SG="$(aws_ ec2 create-security-group --group-name "${PROJECT}-rds-sg" \
    --description "Postgres, reachable only from App Runner" --vpc-id "$VPC_ID" \
    --query GroupId --output text)"
  ok "created RDS SG ${DB_SG}"
else
  ok "RDS SG ${DB_SG} already exists"
fi

aws_ ec2 authorize-security-group-ingress --group-id "$DB_SG" \
  --protocol tcp --port 5432 --source-group "$APP_SG" >/dev/null 2>&1 \
  && ok "allowed 5432 from App Runner SG" || info "5432 rule already present"

if [ "$NETWORK_MODE" = "endpoints" ]; then
  ENDPOINT_SG="$APP_SG"
  aws_ ec2 authorize-security-group-ingress --group-id "$ENDPOINT_SG" \
    --protocol tcp --port 443 --source-group "$APP_SG" >/dev/null 2>&1 || true
  aws_ ec2 create-vpc-endpoint --vpc-id "$VPC_ID" --vpc-endpoint-type Interface \
    --service-name "com.amazonaws.${AWS_REGION}.textract" \
    --subnet-ids "$PRIVATE_SUBNET_A" "$PRIVATE_SUBNET_B" \
    --security-group-ids "$ENDPOINT_SG" --private-dns-enabled >/dev/null 2>&1 \
    && ok "created Textract interface endpoint" || info "Textract endpoint already present"
fi

save APP_SG "$APP_SG"; save DB_SG "$DB_SG"

# ============================ 4. RDS =========================================
step "4/10  RDS PostgreSQL"

SUBNET_GROUP="${PROJECT}-db-subnets"
aws_ rds describe-db-subnet-groups --db-subnet-group-name "$SUBNET_GROUP" >/dev/null 2>&1 \
  || { aws_ rds create-db-subnet-group --db-subnet-group-name "$SUBNET_GROUP" \
        --db-subnet-group-description "SAINT private subnets" \
        --subnet-ids "$PRIVATE_SUBNET_A" "$PRIVATE_SUBNET_B" >/dev/null
       ok "created DB subnet group"; }

DB_ID="${PROJECT}-db"
if aws_ rds describe-db-instances --db-instance-identifier "$DB_ID" >/dev/null 2>&1; then
  ok "RDS instance ${DB_ID} already exists"
  if [ ! -s .db-password ]; then
    die "RDS exists but .db-password is missing. Either delete the instance and re-run, or write the password into .db-password yourself."
  fi
  DB_PASSWORD="$(cat .db-password)"
else
  DB_PASSWORD="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32)"
  printf '%s' "$DB_PASSWORD" > .db-password
  chmod 600 .db-password
  aws_ rds create-db-instance \
    --db-instance-identifier "$DB_ID" \
    --db-instance-class "$DB_INSTANCE_CLASS" \
    --engine postgres \
    --master-username "$DB_USER" \
    --master-user-password "$DB_PASSWORD" \
    --allocated-storage 20 --storage-type gp3 --storage-encrypted \
    --db-name "$DB_NAME" \
    --db-subnet-group-name "$SUBNET_GROUP" \
    --vpc-security-group-ids "$DB_SG" \
    --backup-retention-period 7 \
    --no-publicly-accessible \
    --no-multi-az >/dev/null
  ok "creating RDS instance (this takes 8–12 minutes)…"
  info "password saved to .db-password (gitignored) — keep it or rotate it later"
fi

aws_ rds wait db-instance-available --db-instance-identifier "$DB_ID"
DB_HOST="$(aws_ rds describe-db-instances --db-instance-identifier "$DB_ID" \
  --query 'DBInstances[0].Endpoint.Address' --output text)"
ok "database available at ${DB_HOST}"
save DB_HOST "$DB_HOST"

DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:5432/${DB_NAME}?sslmode=require"

# ============================ 5. S3 ==========================================
step "5/10  S3 bucket for W-9 archives"

W9_BUCKET="${PROJECT}-w9-${ACCOUNT_ID}"
if aws_ s3api head-bucket --bucket "$W9_BUCKET" >/dev/null 2>&1; then
  ok "bucket ${W9_BUCKET} already exists"
else
  if [ "$AWS_REGION" = "us-east-1" ]; then
    aws_ s3api create-bucket --bucket "$W9_BUCKET" >/dev/null
  else
    aws_ s3api create-bucket --bucket "$W9_BUCKET" \
      --create-bucket-configuration "LocationConstraint=${AWS_REGION}" >/dev/null
  fi
  ok "created bucket ${W9_BUCKET}"
fi
aws_ s3api put-public-access-block --bucket "$W9_BUCKET" --public-access-block-configuration \
  'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true'
aws_ s3api put-bucket-encryption --bucket "$W9_BUCKET" --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
aws_ s3api put-bucket-versioning --bucket "$W9_BUCKET" --versioning-configuration Status=Enabled
ok "bucket locked down: no public access, SSE-AES256, versioned"
save W9_BUCKET "$W9_BUCKET"

# ============================ 6. secrets =====================================
step "6/10  Secrets Manager"

put_secret() {  # name value -> arn
  local name="$1" value="$2" arn
  if arn="$(aws_ secretsmanager describe-secret --secret-id "$name" --query ARN --output text 2>/dev/null)"; then
    aws_ secretsmanager put-secret-value --secret-id "$name" --secret-string "$value" >/dev/null
  else
    arn="$(aws_ secretsmanager create-secret --name "$name" --secret-string "$value" \
      --query ARN --output text)"
  fi
  echo "$arn"
}

DB_SECRET_ARN="$(put_secret "${PROJECT}/DATABASE_URL" "$DATABASE_URL")"
ok "stored DATABASE_URL"

if [ -s .cron-secret ]; then CRON_SECRET="$(cat .cron-secret)"
else CRON_SECRET="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 40)"
     printf '%s' "$CRON_SECRET" > .cron-secret; chmod 600 .cron-secret; fi
CRON_SECRET_ARN="$(put_secret "${PROJECT}/CRON_SECRET" "$CRON_SECRET")"
ok "stored CRON_SECRET (also in .cron-secret for your own curl calls)"

# ============================ 7. IAM =========================================
step "7/10  IAM roles"

ECR_ROLE="${PROJECT}-ecr-access-role"
if ! aws iam get-role --role-name "$ECR_ROLE" >/dev/null 2>&1; then
  aws iam create-role --role-name "$ECR_ROLE" --assume-role-policy-document '{
    "Version":"2012-10-17","Statement":[{"Effect":"Allow",
    "Principal":{"Service":"build.apprunner.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
  aws iam attach-role-policy --role-name "$ECR_ROLE" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess
  ok "created ${ECR_ROLE}"
else
  ok "${ECR_ROLE} already exists"
fi
ECR_ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${ECR_ROLE}"

INSTANCE_ROLE="${PROJECT}-instance-role"
if ! aws iam get-role --role-name "$INSTANCE_ROLE" >/dev/null 2>&1; then
  aws iam create-role --role-name "$INSTANCE_ROLE" --assume-role-policy-document '{
    "Version":"2012-10-17","Statement":[{"Effect":"Allow",
    "Principal":{"Service":"tasks.apprunner.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
  ok "created ${INSTANCE_ROLE}"
else
  ok "${INSTANCE_ROLE} already exists"
fi

aws iam put-role-policy --role-name "$INSTANCE_ROLE" --policy-name AppPermissions \
  --policy-document "$(cat <<JSON
{"Version":"2012-10-17","Statement":[
 {"Sid":"Textract","Effect":"Allow","Action":["textract:AnalyzeDocument","textract:DetectDocumentText"],"Resource":"*"},
 {"Sid":"W9Bucket","Effect":"Allow","Action":["s3:PutObject","s3:GetObject"],"Resource":"arn:aws:s3:::${W9_BUCKET}/*"},
 {"Sid":"AlertEmail","Effect":"Allow","Action":["ses:SendEmail","ses:SendRawEmail"],"Resource":"*"},
 {"Sid":"ReadSecrets","Effect":"Allow","Action":["secretsmanager:GetSecretValue"],
  "Resource":["${DB_SECRET_ARN}","${CRON_SECRET_ARN}"]}
]}
JSON
)"
INSTANCE_ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${INSTANCE_ROLE}"
ok "least-privilege policy attached"

# ============================ 8. ECR + image =================================
step "8/10  Build and push container image"

aws_ ecr describe-repositories --repository-names "$PROJECT" >/dev/null 2>&1 \
  || { aws_ ecr create-repository --repository-name "$PROJECT" \
        --image-scanning-configuration scanOnPush=true >/dev/null; ok "created ECR repository"; }

REGISTRY="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
IMAGE="${REGISTRY}/${PROJECT}:latest"

aws_ ecr get-login-password | docker login --username AWS --password-stdin "$REGISTRY" >/dev/null 2>&1
ok "logged in to ECR"

info "building image for linux/amd64 (App Runner does not run arm64 images)…"
docker build --platform linux/amd64 -t "$PROJECT" . >/dev/null
docker tag "${PROJECT}:latest" "$IMAGE"
info "pushing…"
docker push "$IMAGE" >/dev/null
ok "pushed ${IMAGE}"

# ============================ 9. VPC connector ===============================
step "9/10  App Runner VPC connector"

CONNECTOR_NAME="${PROJECT}-connector"
CONNECTOR_ARN="$(aws_ apprunner list-vpc-connectors \
  --query "VpcConnectors[?VpcConnectorName=='${CONNECTOR_NAME}' && Status=='ACTIVE'].VpcConnectorArn | [0]" \
  --output text)"

if [ "$CONNECTOR_ARN" = "None" ] || [ -z "$CONNECTOR_ARN" ]; then
  CONNECTOR_ARN="$(aws_ apprunner create-vpc-connector \
    --vpc-connector-name "$CONNECTOR_NAME" \
    --subnets "$PRIVATE_SUBNET_A" "$PRIVATE_SUBNET_B" \
    --security-groups "$APP_SG" \
    --query 'VpcConnector.VpcConnectorArn' --output text)"
  ok "created VPC connector"
else
  ok "VPC connector already exists"
fi
save CONNECTOR_ARN "$CONNECTOR_ARN"

# ============================ 10. App Runner =================================
step "10/10  App Runner service"

TMP="$(mktemp -d)"
cat > "$TMP/source.json" <<JSON
{
  "AuthenticationConfiguration": { "AccessRoleArn": "${ECR_ROLE_ARN}" },
  "AutoDeploymentsEnabled": true,
  "ImageRepository": {
    "ImageIdentifier": "${IMAGE}",
    "ImageRepositoryType": "ECR",
    "ImageConfiguration": {
      "Port": "3000",
      "RuntimeEnvironmentVariables": {
        "NODE_ENV": "production",
        "AWS_REGION": "${AWS_REGION}",
        "S3_W9_BUCKET": "${W9_BUCKET}",
        "NEWS_PROVIDER": "${NEWS_PROVIDER}",
        "ALERT_FROM_EMAIL": "${ALERT_FROM_EMAIL}",
        "DEFAULT_PROCUREMENT_MANAGER_EMAIL": "${DEFAULT_PROCUREMENT_MANAGER_EMAIL}"
      },
      "RuntimeEnvironmentSecrets": {
        "DATABASE_URL": "${DB_SECRET_ARN}",
        "CRON_SECRET": "${CRON_SECRET_ARN}"
      }
    }
  }
}
JSON

cat > "$TMP/instance.json" <<JSON
{ "Cpu": "${APP_CPU}", "Memory": "${APP_MEMORY}", "InstanceRoleArn": "${INSTANCE_ROLE_ARN}" }
JSON

cat > "$TMP/network.json" <<JSON
{ "EgressConfiguration": { "EgressType": "VPC", "VpcConnectorArn": "${CONNECTOR_ARN}" },
  "IngressConfiguration": { "IsPubliclyAccessible": true } }
JSON

cat > "$TMP/health.json" <<'JSON'
{ "Protocol": "HTTP", "Path": "/api/health", "Interval": 20, "Timeout": 5,
  "HealthyThreshold": 1, "UnhealthyThreshold": 5 }
JSON

SERVICE_ARN="$(aws_ apprunner list-services \
  --query "ServiceSummaryList[?ServiceName=='${PROJECT}'].ServiceArn | [0]" --output text)"

if [ "$SERVICE_ARN" = "None" ] || [ -z "$SERVICE_ARN" ]; then
  SERVICE_ARN="$(aws_ apprunner create-service --service-name "$PROJECT" \
    --source-configuration "file://$TMP/source.json" \
    --instance-configuration "file://$TMP/instance.json" \
    --network-configuration "file://$TMP/network.json" \
    --health-check-configuration "file://$TMP/health.json" \
    --query 'Service.ServiceArn' --output text)"
  ok "creating App Runner service (5–8 minutes)…"
else
  aws_ apprunner update-service --service-arn "$SERVICE_ARN" \
    --source-configuration "file://$TMP/source.json" \
    --instance-configuration "file://$TMP/instance.json" \
    --health-check-configuration "file://$TMP/health.json" >/dev/null
  ok "updating existing service…"
fi
save SERVICE_ARN "$SERVICE_ARN"
rm -rf "$TMP"

info "waiting for the service to reach RUNNING…"
for i in $(seq 1 80); do
  STATUS="$(aws_ apprunner describe-service --service-arn "$SERVICE_ARN" \
    --query 'Service.Status' --output text)"
  case "$STATUS" in
    RUNNING) break ;;
    CREATE_FAILED|DELETE_FAILED)
      die "service entered ${STATUS}. Check CloudWatch: /aws/apprunner/${PROJECT}" ;;
    *) printf "\r  ${DIM}·${RST} status: %-24s (%ds)" "$STATUS" $((i*15)); sleep 15 ;;
  esac
done
echo

[ "$STATUS" = "RUNNING" ] || die "timed out waiting for RUNNING (last status: ${STATUS})"

APP_URL="https://$(aws_ apprunner describe-service --service-arn "$SERVICE_ARN" \
  --query 'Service.ServiceUrl' --output text)"
save APP_URL "$APP_URL"

# ============================ done ===========================================
step "Verifying"
HEALTH="$(curl -fsS --max-time 20 "${APP_URL}/api/health" || echo '{"status":"unreachable"}')"
echo "  ${HEALTH}"

case "$HEALTH" in
  *'"db":"up"'*) ok "application and database are healthy" ;;
  *) warn "health check did not report db:up — see the troubleshooting table in docs/DEPLOYMENT.md" ;;
esac

echo
echo "${BOLD}${GRN}Deployed.${RST}"
echo
echo "  URL            ${BOLD}${APP_URL}${RST}"
echo "  Region         ${AWS_REGION}"
echo "  Database       ${DB_HOST}"
echo "  W-9 bucket     ${W9_BUCKET}"
echo "  Logs           aws logs tail /aws/apprunner/${PROJECT} --follow --region ${AWS_REGION}"
echo
echo "  Load 10 demo suppliers:"
echo "    curl -X POST ${APP_URL}/api/admin/seed -H \"Authorization: Bearer \$(cat .cron-secret)\""
echo
echo "  Tear everything down:"
echo "    ./scripts/teardown-aws.sh"
echo
