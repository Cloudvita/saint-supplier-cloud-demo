#!/usr/bin/env bash
# =============================================================================
# Delete everything deploy-aws.sh created. Destructive — the database goes too.
#
#   ./scripts/teardown-aws.sh            # asks for confirmation
#   FORCE=1 ./scripts/teardown-aws.sh    # no prompt
# =============================================================================
set -uo pipefail

PROJECT="${PROJECT:-saint-supplier-management}"
AWS_REGION="${AWS_REGION:-us-east-1}"
aws_() { aws --region "$AWS_REGION" "$@"; }

BOLD=$'\033[1m'; DIM=$'\033[2m'; GRN=$'\033[32m'; RED=$'\033[31m'; RST=$'\033[0m'
step() { echo; echo "${BOLD}▸ $*${RST}"; }
ok()   { echo "  ${GRN}✓${RST} $*"; }
info() { echo "  ${DIM}·${RST} $*"; }

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"

if [ "${FORCE:-0}" != "1" ]; then
  echo "${RED}${BOLD}This deletes the App Runner service, the RDS database and all its data,"
  echo "the W-9 S3 bucket and its contents, IAM roles, secrets and the VPC.${RST}"
  echo
  read -r -p "Type the project name to confirm (${PROJECT}): " CONFIRM
  [ "$CONFIRM" = "$PROJECT" ] || { echo "Aborted."; exit 1; }
fi

# --- App Runner service -------------------------------------------------------
step "App Runner service"
SERVICE_ARN="$(aws_ apprunner list-services \
  --query "ServiceSummaryList[?ServiceName=='${PROJECT}'].ServiceArn | [0]" --output text)"
if [ "$SERVICE_ARN" != "None" ] && [ -n "$SERVICE_ARN" ]; then
  aws_ apprunner delete-service --service-arn "$SERVICE_ARN" >/dev/null
  info "waiting for the service to disappear…"
  for _ in $(seq 1 60); do
    aws_ apprunner describe-service --service-arn "$SERVICE_ARN" >/dev/null 2>&1 || break
    sleep 10
  done
  ok "deleted"
else
  info "no service found"
fi

# --- VPC connector ------------------------------------------------------------
step "VPC connector"
for arn in $(aws_ apprunner list-vpc-connectors \
    --query "VpcConnectors[?VpcConnectorName=='${PROJECT}-connector'].VpcConnectorArn" --output text); do
  aws_ apprunner delete-vpc-connector --vpc-connector-arn "$arn" >/dev/null 2>&1 && ok "deleted connector"
done

# --- RDS ----------------------------------------------------------------------
step "RDS instance"
if aws_ rds describe-db-instances --db-instance-identifier "${PROJECT}-db" >/dev/null 2>&1; then
  aws_ rds delete-db-instance --db-instance-identifier "${PROJECT}-db" \
    --skip-final-snapshot --delete-automated-backups >/dev/null
  info "waiting for the database to delete (a few minutes)…"
  aws_ rds wait db-instance-deleted --db-instance-identifier "${PROJECT}-db" 2>/dev/null
  ok "deleted"
else
  info "no database found"
fi
aws_ rds delete-db-subnet-group --db-subnet-group-name "${PROJECT}-db-subnets" >/dev/null 2>&1 \
  && ok "deleted DB subnet group"

# --- S3 -----------------------------------------------------------------------
step "S3 bucket"
BUCKET="${PROJECT}-w9-${ACCOUNT_ID}"
if aws_ s3api head-bucket --bucket "$BUCKET" >/dev/null 2>&1; then
  # versioned bucket: delete every version and delete-marker first
  aws_ s3api list-object-versions --bucket "$BUCKET" --output json \
    --query '{Objects: Versions[].{Key:Key,VersionId:VersionId}}' > /tmp/v.json 2>/dev/null
  if [ -s /tmp/v.json ] && ! grep -q '"Objects": null' /tmp/v.json; then
    aws_ s3api delete-objects --bucket "$BUCKET" --delete file:///tmp/v.json >/dev/null 2>&1
  fi
  aws_ s3api list-object-versions --bucket "$BUCKET" --output json \
    --query '{Objects: DeleteMarkers[].{Key:Key,VersionId:VersionId}}' > /tmp/d.json 2>/dev/null
  if [ -s /tmp/d.json ] && ! grep -q '"Objects": null' /tmp/d.json; then
    aws_ s3api delete-objects --bucket "$BUCKET" --delete file:///tmp/d.json >/dev/null 2>&1
  fi
  aws_ s3 rb "s3://${BUCKET}" --force >/dev/null 2>&1 && ok "deleted ${BUCKET}"
else
  info "no bucket found"
fi

# --- ECR ----------------------------------------------------------------------
step "ECR repository"
aws_ ecr delete-repository --repository-name "$PROJECT" --force >/dev/null 2>&1 \
  && ok "deleted" || info "no repository found"

# --- secrets ------------------------------------------------------------------
step "Secrets"
for s in "${PROJECT}/DATABASE_URL" "${PROJECT}/CRON_SECRET"; do
  aws_ secretsmanager delete-secret --secret-id "$s" --force-delete-without-recovery >/dev/null 2>&1 \
    && ok "deleted $s"
done

# --- IAM ----------------------------------------------------------------------
step "IAM roles"
aws iam delete-role-policy --role-name "${PROJECT}-instance-role" --policy-name AppPermissions >/dev/null 2>&1
aws iam delete-role --role-name "${PROJECT}-instance-role" >/dev/null 2>&1 && ok "deleted instance role"
aws iam detach-role-policy --role-name "${PROJECT}-ecr-access-role" \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess >/dev/null 2>&1
aws iam delete-role --role-name "${PROJECT}-ecr-access-role" >/dev/null 2>&1 && ok "deleted ECR access role"

# --- networking ---------------------------------------------------------------
step "Networking"
VPC_ID="$(aws_ ec2 describe-vpcs --filters "Name=tag:Name,Values=${PROJECT}-vpc" \
  --query 'Vpcs[0].VpcId' --output text)"

if [ "$VPC_ID" = "None" ] || [ -z "$VPC_ID" ]; then
  info "no VPC found"
else
  for nat in $(aws_ ec2 describe-nat-gateways --filter "Name=vpc-id,Values=${VPC_ID}" \
      "Name=state,Values=available,pending" --query 'NatGateways[].NatGatewayId' --output text); do
    aws_ ec2 delete-nat-gateway --nat-gateway-id "$nat" >/dev/null
    info "waiting for NAT gateway to delete…"
    aws_ ec2 wait nat-gateway-deleted --nat-gateway-ids "$nat" 2>/dev/null
    ok "deleted NAT gateway"
  done

  for eip in $(aws_ ec2 describe-addresses --filters "Name=tag:Name,Values=${PROJECT}-nat-eip" \
      --query 'Addresses[].AllocationId' --output text); do
    aws_ ec2 release-address --allocation-id "$eip" >/dev/null 2>&1 && ok "released elastic IP"
  done

  for ep in $(aws_ ec2 describe-vpc-endpoints --filters "Name=vpc-id,Values=${VPC_ID}" \
      --query 'VpcEndpoints[].VpcEndpointId' --output text); do
    aws_ ec2 delete-vpc-endpoints --vpc-endpoint-ids "$ep" >/dev/null 2>&1 && ok "deleted VPC endpoint"
  done

  # App Runner's hyperplane ENIs linger briefly after the connector is deleted
  info "waiting for network interfaces to release…"
  for _ in $(seq 1 30); do
    LEFT="$(aws_ ec2 describe-network-interfaces --filters "Name=vpc-id,Values=${VPC_ID}" \
      --query 'length(NetworkInterfaces)' --output text)"
    [ "$LEFT" = "0" ] && break
    sleep 10
  done

  for igw in $(aws_ ec2 describe-internet-gateways --filters "Name=attachment.vpc-id,Values=${VPC_ID}" \
      --query 'InternetGateways[].InternetGatewayId' --output text); do
    aws_ ec2 detach-internet-gateway --internet-gateway-id "$igw" --vpc-id "$VPC_ID" >/dev/null 2>&1
    aws_ ec2 delete-internet-gateway --internet-gateway-id "$igw" >/dev/null 2>&1 && ok "deleted internet gateway"
  done

  for sn in $(aws_ ec2 describe-subnets --filters "Name=vpc-id,Values=${VPC_ID}" \
      --query 'Subnets[].SubnetId' --output text); do
    aws_ ec2 delete-subnet --subnet-id "$sn" >/dev/null 2>&1 && ok "deleted subnet ${sn}"
  done

  for rt in $(aws_ ec2 describe-route-tables --filters "Name=vpc-id,Values=${VPC_ID}" \
      --query 'RouteTables[?length(Associations[?Main==`true`])==`0`].RouteTableId' --output text); do
    aws_ ec2 delete-route-table --route-table-id "$rt" >/dev/null 2>&1 && ok "deleted route table"
  done

  for sg in $(aws_ ec2 describe-security-groups --filters "Name=vpc-id,Values=${VPC_ID}" \
      --query 'SecurityGroups[?GroupName!=`default`].GroupId' --output text); do
    aws_ ec2 delete-security-group --group-id "$sg" >/dev/null 2>&1 && ok "deleted security group"
  done

  aws_ ec2 delete-vpc --vpc-id "$VPC_ID" >/dev/null 2>&1 && ok "deleted VPC ${VPC_ID}" \
    || info "VPC still has dependencies — re-run this script in a minute"
fi

rm -f .aws-deploy-state .db-password .cron-secret
echo
echo "${BOLD}${GRN}Teardown complete.${RST} Check the AWS Billing console in a day to confirm nothing is still running."
echo
