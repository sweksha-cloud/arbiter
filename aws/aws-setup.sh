#!/usr/bin/env bash
# One-time AWS setup for automatic deploys (aws/README.md, step 4).
# Run in AWS CloudShell (region: Oregon). Paste it as
#   bash -s <<'SETUP'
#   …this file…
#   SETUP
# so a failing step can't close the CloudShell session. Safe to run again:
# anything that already exists is kept.
set -uo pipefail

REGION=us-west-2
INSTANCE="${INSTANCE:?Set INSTANCE to the EC2 instance ID, e.g. INSTANCE=i-0123… bash -s}"
REPO=sweksha-cloud/arbiter
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
OIDC="arn:aws:iam::$ACCOUNT:oidc-provider/token.actions.githubusercontent.com"

# Runs a step, treating "already exists" as done.
step() {
  local out
  if out="$("$@" 2>&1)"; then return 0; fi
  if grep -qE 'EntityAlreadyExists|already associated|LimitExceeded.*InstanceProfile' <<< "$out"; then echo "  (already there)"; return 0; fi
  echo "$out"
  echo "FAILED: $*"
  exit 1
}

echo "1/3 Let the server take deploy commands from AWS Systems Manager"
step aws iam create-role --role-name arbiter-ec2-ssm --assume-role-policy-document \
  '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
step aws iam attach-role-policy --role-name arbiter-ec2-ssm --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
step aws iam create-instance-profile --instance-profile-name arbiter-ec2-ssm
step aws iam add-role-to-instance-profile --instance-profile-name arbiter-ec2-ssm --role-name arbiter-ec2-ssm
sleep 15 # IAM takes a moment before EC2 can see a new profile
step aws ec2 associate-iam-instance-profile --region "$REGION" --instance-id "$INSTANCE" \
  --iam-instance-profile Name=arbiter-ec2-ssm

echo "2/3 Let GitHub Actions sign in to AWS for one run at a time (no stored keys)"
step aws iam create-open-id-connect-provider --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
# The provider existed before this setup the first time, and AWS refused
# GitHub's sign-in; the likeliest cause is a missing audience. Adding it is harmless if present.
aws iam add-client-id-to-open-id-connect-provider --open-id-connect-provider-arn "$OIDC" \
  --client-id sts.amazonaws.com 2> /dev/null || true

echo "3/3 A deploy role only main of $REPO can use, allowed only to run commands on this server"
step aws iam create-role --role-name arbiter-github-deploy --assume-role-policy-document "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{
    \"Effect\": \"Allow\",
    \"Principal\": {\"Federated\": \"$OIDC\"},
    \"Action\": \"sts:AssumeRoleWithWebIdentity\",
    \"Condition\": {\"StringEquals\": {
      \"token.actions.githubusercontent.com:aud\": \"sts.amazonaws.com\",
      \"token.actions.githubusercontent.com:sub\": \"repo:$REPO:ref:refs/heads/main\"
    }}
  }]
}"
# Always rewritten, so a new instance ID takes effect.
step aws iam put-role-policy --role-name arbiter-github-deploy --policy-name run-deploy-on-arbiter --policy-document "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [
    {\"Effect\": \"Allow\", \"Action\": \"ssm:SendCommand\", \"Resource\": [
      \"arn:aws:ec2:$REGION:$ACCOUNT:instance/$INSTANCE\",
      \"arn:aws:ssm:$REGION::document/AWS-RunShellScript\"
    ]},
    {\"Effect\": \"Allow\", \"Action\": \"ssm:GetCommandInvocation\", \"Resource\": \"*\"}
  ]
}"

echo
echo "Done. GitHub repo variables:"
echo "  AWS_DEPLOY_ROLE_ARN=arn:aws:iam::$ACCOUNT:role/arbiter-github-deploy"
echo "  AWS_REGION=$REGION"
echo "  EC2_INSTANCE_ID=$INSTANCE"
