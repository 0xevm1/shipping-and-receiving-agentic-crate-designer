#!/bin/sh
# One-shot bucket setup for the blob emulator (#46 slice 1a), run by the `blob-init` compose
# service: creates each bucket if it's missing and applies the CORS rule that lets the browser
# GET presigned URLs. Safe to run again.
set -eu
for bucket in $BLOB_BUCKETS; do
  if aws s3api head-bucket --bucket "$bucket" >/dev/null 2>&1; then
    echo "bucket $bucket: exists"
  else
    aws s3api create-bucket --bucket "$bucket" >/dev/null
    echo "bucket $bucket: created"
  fi
  aws s3api put-bucket-cors --bucket "$bucket" --cors-configuration file:///infra/blob-cors.json
  echo "bucket $bucket: CORS applied"
done
