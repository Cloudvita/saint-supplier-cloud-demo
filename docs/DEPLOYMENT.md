# SAINT Supplier Management — Deployment Guide

End-to-end: local run → GitHub → RDS PostgreSQL → S3 + Textract + SES → App Runner → CI/CD.

Everything below uses **us-east-1**. Substitute your region consistently if you change it.

---

## Phase 0 — Prerequisites

| Tool | Check |
|---|---|
| Node.js 22+ | `node -v` |
| Docker | `docker -v` |
| AWS CLI v2, configured | `aws sts get-caller-identity` |
| GitHub CLI (optional) | `gh auth status` |

Capture your account ID once — several commands need it:

```bash
export AWS_REGION=us-east-1
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo $ACCOUNT_ID
```

---

## Phase 1 — Run it locally first

Prove the app works before adding cloud moving parts.

```bash
cd saint-supplier-management
cp .env.example .env
docker compose up -d          # Postgres 16 on localhost:5432
npm install
npm run db:migrate            # creates the 4 tables + enums
npm run db:seed               # 10 demo suppliers
npm run dev
```

Open <http://localhost:3000>. You should see the onboarding form and a table of 10 suppliers.
Click **Refresh** on a row — the mock news provider fills the Market News field and raises
risk alerts for merger / bankruptcy headlines.

> W-9 extraction needs AWS credentials (Phase 4). Until then it returns a clear error and
> everything else keeps working.

---

## Phase 2 — Put the code in GitHub

```bash
git init
git add .
git commit -m "feat: SAINT supplier management module"
git branch -M main
```

Create the remote and push:

```bash
# with the GitHub CLI
gh repo create saint-supplier-management --private --source=. --remote=origin --push

# or manually, after creating an empty repo in the GitHub UI
git remote add origin https://github.com/<your-org>/saint-supplier-management.git
git push -u origin main
```

Branch protection worth turning on now (Settings → Branches → Add rule on `main`):
require a PR, require the **CI** check to pass.

**Never commit `.env`.** It is already in `.gitignore`; `.env.example` is the template you share.

---

## Phase 3 — Amazon RDS for PostgreSQL

### 3.1 Create the database

Console → RDS → **Create database**:

| Setting | Value |
|---|---|
| Engine | PostgreSQL 16.x |
| Template | Dev/Test (or Production for multi-AZ) |
| DB instance identifier | `saint-db` |
| Master username | `saintadmin` |
| Credentials management | **Managed in AWS Secrets Manager** (recommended) |
| Instance class | `db.t4g.micro` (dev) → `db.t4g.small`+ for real load |
| Storage | 20 GB gp3, autoscaling on |
| Public access | **No** (see 3.3 for how to reach it) |
| VPC security group | create new: `saint-db-sg` |
| Initial database name | `saint` |
| Encryption | Enabled (default KMS key) |
| Backup retention | 7 days |

CLI equivalent:

```bash
aws rds create-db-instance \
  --db-instance-identifier saint-db \
  --db-instance-class db.t4g.micro \
  --engine postgres --engine-version 16.4 \
  --master-username saintadmin \
  --manage-master-user-password \
  --allocated-storage 20 --storage-type gp3 --storage-encrypted \
  --db-name saint \
  --backup-retention-period 7 \
  --no-publicly-accessible \
  --region $AWS_REGION
```

Wait for status `available` (~5–10 min), then grab the endpoint:

```bash
aws rds describe-db-instances --db-instance-identifier saint-db \
  --query 'DBInstances[0].Endpoint.Address' --output text
```

### 3.2 Build the connection string

```
postgresql://saintadmin:<PASSWORD>@saint-db.xxxxxxxx.us-east-1.rds.amazonaws.com:5432/saint?sslmode=require
```

`sslmode=require` is not optional — RDS enforces TLS and the app's driver reads it from the URL.

If you chose Secrets Manager, read the password with:

```bash
aws secretsmanager get-secret-value --secret-id <secret-arn> --query SecretString --output text
```

### 3.3 Running the first migration against a private RDS

The database has no public IP, so pick one of these:

**Option A — SSM port-forward through a bastion (recommended).**
Launch a `t4g.nano` EC2 instance in the same VPC with the SSM role attached, then:

```bash
aws ssm start-session --target <instance-id> \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters '{"host":["saint-db.xxxx.us-east-1.rds.amazonaws.com"],"portNumber":["5432"],"localPortNumber":["5433"]}'

# in another shell
DATABASE_URL="postgresql://saintadmin:<PW>@localhost:5433/saint" npx drizzle-kit migrate
```

**Option B — temporarily make RDS publicly accessible**, allow your IP in `saint-db-sg`,
run `npx drizzle-kit migrate`, then turn public access back off. Fine for a dev instance,
not for anything with real supplier data.

Verify:

```bash
psql "$DATABASE_URL" -c '\dt'
# suppliers | w9_documents | market_news_items | risk_alerts
```

---

## Phase 4 — S3, Textract and SES

### 4.1 S3 bucket for W-9 archives

```bash
export W9_BUCKET=saint-w9-$ACCOUNT_ID

aws s3api create-bucket --bucket $W9_BUCKET --region $AWS_REGION
aws s3api put-public-access-block --bucket $W9_BUCKET \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-encryption --bucket $W9_BUCKET \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
aws s3api put-bucket-versioning --bucket $W9_BUCKET --versioning-configuration Status=Enabled
```

W-9s contain TINs — keep the bucket private forever. The app only ever hands out
5-minute presigned URLs.

### 4.2 Textract

Nothing to provision. Confirm it works in your region:

```bash
aws textract analyze-document \
  --document '{"S3Object":{"Bucket":"'"$W9_BUCKET"'","Name":"w9/sample.pdf"}}' \
  --feature-types '["FORMS"]' --region $AWS_REGION --query 'Blocks[0].BlockType'
```

Limits the code already respects: synchronous `AnalyzeDocument` accepts PDF/PNG/JPEG/TIFF
up to 10 MB and a single page. Multi-page W-9 packets would need the async
`StartDocumentAnalysis` flow — a natural next iteration.

### 4.3 SES for alert email

```bash
aws ses verify-email-identity --email-address alerts@yourcompany.com --region $AWS_REGION
aws ses verify-email-identity --email-address procurement.manager@yourcompany.com --region $AWS_REGION
```

New SES accounts are in **sandbox mode**: you can only send to verified addresses.
Request production access in the SES console before going live. Verifying your whole
domain (DKIM) is better than individual addresses for anything real.

---

## Phase 5 — Container image in ECR

```bash
aws ecr create-repository --repository-name saint-supplier-management \
  --image-scanning-configuration scanOnPush=true --region $AWS_REGION

aws ecr get-login-password --region $AWS_REGION \
  | docker login --username AWS --password-stdin $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com

docker build -t saint-supplier-management .
docker tag saint-supplier-management:latest \
  $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/saint-supplier-management:latest
docker push $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/saint-supplier-management:latest
```

---

## Phase 6 — IAM roles for App Runner

App Runner needs two roles. Neither involves storing an access key anywhere.

### 6.1 Access role — lets App Runner pull from ECR

```bash
cat > /tmp/apprunner-ecr-trust.json <<'EOF'
{"Version":"2012-10-17","Statement":[{"Effect":"Allow",
 "Principal":{"Service":"build.apprunner.amazonaws.com"},"Action":"sts:AssumeRole"}]}
EOF

aws iam create-role --role-name SaintAppRunnerECRAccessRole \
  --assume-role-policy-document file:///tmp/apprunner-ecr-trust.json
aws iam attach-role-policy --role-name SaintAppRunnerECRAccessRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess
```

### 6.2 Instance role — what the running app may do

```bash
cat > /tmp/apprunner-tasks-trust.json <<'EOF'
{"Version":"2012-10-17","Statement":[{"Effect":"Allow",
 "Principal":{"Service":"tasks.apprunner.amazonaws.com"},"Action":"sts:AssumeRole"}]}
EOF

aws iam create-role --role-name SaintAppRunnerInstanceRole \
  --assume-role-policy-document file:///tmp/apprunner-tasks-trust.json

cat > /tmp/saint-app-policy.json <<EOF
{"Version":"2012-10-17","Statement":[
 {"Sid":"Textract","Effect":"Allow",
  "Action":["textract:AnalyzeDocument","textract:DetectDocumentText"],"Resource":"*"},
 {"Sid":"W9Bucket","Effect":"Allow",
  "Action":["s3:PutObject","s3:GetObject"],"Resource":"arn:aws:s3:::$W9_BUCKET/*"},
 {"Sid":"AlertEmail","Effect":"Allow",
  "Action":["ses:SendEmail","ses:SendRawEmail"],"Resource":"*"},
 {"Sid":"ReadDbSecret","Effect":"Allow",
  "Action":["secretsmanager:GetSecretValue"],"Resource":"arn:aws:secretsmanager:$AWS_REGION:$ACCOUNT_ID:secret:saint/*"}
]}
EOF

aws iam put-role-policy --role-name SaintAppRunnerInstanceRole \
  --policy-name SaintAppPermissions --policy-document file:///tmp/saint-app-policy.json
```

That is least privilege: Textract read, write-only-to-one-bucket, send mail, read one
secret prefix. Nothing else.

---

## Phase 7 — Store the database URL as a secret

```bash
aws secretsmanager create-secret --name saint/DATABASE_URL \
  --secret-string "postgresql://saintadmin:<PW>@saint-db.xxxx.us-east-1.rds.amazonaws.com:5432/saint?sslmode=require" \
  --region $AWS_REGION
```

App Runner can reference a secret ARN directly as an environment variable, so the
connection string never appears in the service configuration or in your repo.

---

## Phase 8 — VPC connector (App Runner → private RDS)

App Runner runs outside your VPC by default. To reach a private RDS instance it needs a
VPC connector attached to your **private subnets**.

```bash
aws apprunner create-vpc-connector \
  --vpc-connector-name saint-vpc-connector \
  --subnets subnet-aaa subnet-bbb \
  --security-groups sg-apprunner \
  --region $AWS_REGION
```

Then allow that security group into Postgres:

```bash
aws ec2 authorize-security-group-ingress \
  --group-id <saint-db-sg-id> --protocol tcp --port 5432 --source-group sg-apprunner
```

> **This is the single most common failure point.** If the app boots but `/api/health`
> reports `db: down`, it is almost always a missing VPC connector or a security group that
> does not allow 5432 from the App Runner SG.
>
> Note that a VPC connector routes *all* outbound traffic through your VPC, so the subnets
> need a NAT gateway for the app to still reach Textract, SES and any news API. If you want
> to avoid NAT costs on a dev environment, add VPC endpoints for Textract/S3 instead.

---

## Phase 9 — Create the App Runner service

Console → App Runner → **Create service**:

| Setting | Value |
|---|---|
| Source | Container registry → Amazon ECR |
| Image URI | `<account>.dkr.ecr.us-east-1.amazonaws.com/saint-supplier-management:latest` |
| Deployment trigger | Automatic |
| ECR access role | `SaintAppRunnerECRAccessRole` |
| Service name | `saint-supplier-management` |
| Virtual CPU / memory | 0.25 vCPU / 0.5 GB (dev) — 1 vCPU / 2 GB for production |
| Port | `3000` |
| Instance role | `SaintAppRunnerInstanceRole` |
| Health check | HTTP, path `/api/health`, interval 20s |
| Networking → Outgoing | Custom VPC → `saint-vpc-connector` |

Environment variables:

| Key | Value |
|---|---|
| `DATABASE_URL` | *secret reference* → `arn:aws:secretsmanager:...:secret:saint/DATABASE_URL` |
| `AWS_REGION` | `us-east-1` |
| `S3_W9_BUCKET` | `saint-w9-<account-id>` |
| `NEWS_PROVIDER` | `mock` (switch to `newsapi` / `rss` when ready) |
| `NEWS_API_KEY` | *secret reference*, only if using NewsAPI |
| `ALERT_FROM_EMAIL` | `alerts@yourcompany.com` |
| `DEFAULT_PROCUREMENT_MANAGER_EMAIL` | fallback recipient |
| `CRON_SECRET` | *secret reference*, random 32+ chars |
| `NODE_ENV` | `production` |

Deploy. When it reports **Running**:

```bash
curl https://<random>.us-east-1.awsapprunner.com/api/health
# {"status":"ok","db":"up","ts":"..."}
```

Then open the URL in a browser and add a supplier.

---

## Phase 10 — CI/CD from GitHub

Two workflows ship with the repo.

**`.github/workflows/ci.yml`** — on every PR: spins up Postgres, applies migrations, seeds,
typechecks, builds.

**`.github/workflows/deploy.yml`** — on push to `main`: builds the image, pushes to ECR,
runs migrations, triggers an App Runner deployment.

### 10.1 GitHub → AWS via OIDC (no stored keys)

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

Create `SaintGitHubDeployRole` trusting your repo:

```json
{"Version":"2012-10-17","Statement":[{
  "Effect":"Allow",
  "Principal":{"Federated":"arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"},
  "Action":"sts:AssumeRoleWithWebIdentity",
  "Condition":{
    "StringEquals":{"token.actions.githubusercontent.com:aud":"sts.amazonaws.com"},
    "StringLike":{"token.actions.githubusercontent.com:sub":"repo:<your-org>/saint-supplier-management:*"}
  }}]}
```

Attach permissions for `ecr:*` on your repository and `apprunner:StartDeployment` on your
service ARN.

### 10.2 Repository secrets

Settings → Secrets and variables → Actions:

| Secret | Value |
|---|---|
| `AWS_DEPLOY_ROLE_ARN` | `arn:aws:iam::<account>:role/SaintGitHubDeployRole` |
| `APPRUNNER_SERVICE_ARN` | from `aws apprunner list-services` |
| `DATABASE_URL` | connection string used by the migration step |

> The migration step in `deploy.yml` runs on a GitHub-hosted runner, which cannot reach a
> private RDS instance. Either run migrations from a self-hosted runner inside the VPC, run
> them manually through the SSM tunnel from Phase 3.3, or move them into a one-off ECS task.
> Delete that step from the workflow if you go the manual route.

---

## Phase 11 — Scheduled news refresh

The batch endpoint refreshes every supplier on a cadence:

```
POST /api/news/refresh
Authorization: Bearer $CRON_SECRET
{"cadence":"WEEKLY"}
```

Wire it to **EventBridge Scheduler** (Mondays 07:00 UTC weekly, 1st of month for monthly)
targeting a small Lambda that makes the HTTPS call, or simply add a scheduled GitHub Action
with `curl`. Both are fine; the Lambda keeps the secret inside AWS.

---

## Phase 12 — Operating it

| Concern | Where |
|---|---|
| Application logs | CloudWatch → `/aws/apprunner/saint-supplier-management/.../application` |
| Health | `/api/health` — also the App Runner health check |
| DB metrics | RDS → Monitoring (connections, CPU, free storage) |
| Cost guardrail | AWS Budgets alert at your monthly threshold |
| Backups | RDS automated backups, 7-day retention; take a manual snapshot before schema changes |

### Rough monthly cost, dev-sized

| Service | Config | Approx |
|---|---|---|
| App Runner | 0.25 vCPU / 0.5 GB, light traffic | memory is $0.007/GB-hr provisioned; vCPU $0.064/vCPU-hr only while serving requests |
| RDS | `db.t4g.micro`, 20 GB gp3, single-AZ | low tens of dollars |
| S3 | a few GB of W-9s | cents |
| Textract | Forms feature | ~$0.05 per page (first-tier, US West published rate); 100 pages/month free for new accounts |
| SES | alert volume | $0.10 per 1,000 emails |

Prices change — confirm against the [App Runner](https://aws.amazon.com/apprunner/pricing/)
and [Textract](https://aws.amazon.com/textract/pricing/) pricing pages and the AWS Pricing
Calculator before you commit to a budget.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `/api/health` → `db: down` | No VPC connector, or SG blocks 5432 | Phase 8 |
| `no pg_hba.conf entry ... no encryption` | Missing `sslmode=require` | Fix `DATABASE_URL` |
| W-9 upload → `AccessDeniedException` | Instance role missing `textract:AnalyzeDocument` | Phase 6.2 |
| W-9 saves but no S3 object | `S3_W9_BUCKET` unset | Set the env var |
| Alerts logged, never emailed | `ALERT_FROM_EMAIL` unset, or SES sandbox | Phase 4.3 |
| News always mock data | `NEWS_PROVIDER` still `mock` | Set `newsapi` or `rss` + key |
| Deploy succeeds, page 500s | Migrations not applied to that database | Re-run `npx drizzle-kit migrate` |
| App Runner stuck `OPERATION_IN_PROGRESS` | Health check failing on `/` instead of `/api/health` | Correct the health check path |

---

## Suggested next iterations

1. **Authentication** — Cognito or your SSO in front of the service. There is none today.
2. **Async Textract** for multi-page W-9 packets (`StartDocumentAnalysis` + SNS).
3. **TIN validation** against the IRS TIN Matching service.
4. **LLM classification** — swap the keyword rules in `classifier.ts` for a Bedrock call to
   catch risk events the regexes miss.
5. **Audit trail** — an append-only table of who changed which supplier field and when
   (procurement audits will ask).
6. **Duplicate detection** — fuzzy-match legal name + TIN on create to stop duplicate
   vendor masters, the classic S2P data-quality problem.
