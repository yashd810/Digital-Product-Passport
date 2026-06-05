# S3 Production Setup Guide
**Your Credentials:**
- Bucket: `dpp-prod-files`
- Namespace: `axknlhgrqwn0`
- Region: `eu-stockholm-1`
- Endpoint: `https://axknlhgrqwn0.compat.objectstorage.eu-stockholm-1.oci.customer-oci.com`

---

## Quick Setup (3 Steps)

### Step 1: Get Your Credentials from OCI Console

If you don't have these yet:

1. Log into [OCI Console](https://cloud.oracle.com)
2. Click your **Profile** (top right corner)
3. Select **Auth Tokens** or **Customer Secret Keys**
4. Click **Generate Secret Key** or create **New Auth Token**
5. **Copy both values immediately:**
   - **Username/Customer ID** = Your `STORAGE_S3_ACCESS_KEY_ID`
   - **Secret Key/Auth Token** = Your `STORAGE_S3_SECRET_ACCESS_KEY`

⚠️ **Important:** You won't see the secret again, so copy it immediately!

---

### Step 2: Update OCI Backend Configuration

Run this command on your LOCAL machine:

```bash
# SSH to OCI backend
ssh -i "~/Desktop/Digital Product Passport/Project Files/AMD keys/ssh-key-2026-04-27.key" ubuntu@82.70.54.173
```

Then on the OCI backend:

```bash
# Edit the production config
nano /etc/dpp/.env.prod
```

**Find these lines and UPDATE them:**

```bash
# OLD VALUES - Find and replace:
STORAGE_PROVIDER=local
STORAGE_S3_BUCKET=claros-dpp
STORAGE_S3_ACCESS_KEY_ID=replace_me_access_key
STORAGE_S3_SECRET_ACCESS_KEY=replace_me_secret_key

# NEW VALUES - Replace with:
STORAGE_PROVIDER=s3
STORAGE_S3_BUCKET=dpp-prod-files
STORAGE_S3_ENDPOINT=https://axknlhgrqwn0.compat.objectstorage.eu-stockholm-1.oci.customer-oci.com
STORAGE_S3_REGION=eu-stockholm-1
STORAGE_S3_ACCESS_KEY_ID=[YOUR_ACCESS_KEY_FROM_OCI]
STORAGE_S3_SECRET_ACCESS_KEY=[YOUR_SECRET_KEY_FROM_OCI]
STORAGE_S3_PUBLIC_BASE_URL=https://axknlhgrqwn0.compat.objectstorage.eu-stockholm-1.oci.customer-oci.com/dpp-prod-files
STORAGE_S3_FORCE_PATH_STYLE=true
```

**To save in nano:**
- Press: `Ctrl+O` (save)
- Press: `Enter`
- Press: `Ctrl+X` (exit)

---

### Step 3: Restart Services & Verify

Still on the OCI backend, run:

```bash
cd /opt/dpp

# Stop current services
docker compose -f docker/docker-compose.prod.backend.yml down

# Start services with new S3 config
docker compose -f docker/docker-compose.prod.backend.yml up -d

# Wait for services to start
sleep 40

# Check health
curl http://localhost:3001/health | jq '.'
```

**Expected output:**
```json
{
  "status": "OK",
  "architecture": "dynamic-per-company-tables",
  "database": "connected"
}
```

---

## Verify S3 is Working

### Check Backend Logs

```bash
# Look for S3 initialization messages
docker logs docker-backend-api-1 | grep -i "s3\|storage" | tail -20
```

Should see messages like:
- ✅ `S3 storage provider initialized`
- ✅ `Connected to S3 bucket: dpp-prod-files`

### Test File Upload

1. Access frontend: `https://claros-dpp.online`
2. Create a test passport
3. Upload a file attachment (PDF, image, etc.)
4. Go to OCI Console → Object Storage → `dpp-prod-files`
5. You should see your uploaded file there!

---

## Troubleshooting

### Backend won't start?

```bash
docker logs docker-backend-api-1 2>&1 | head -50
```

Look for these errors:

| Error | Cause | Fix |
|-------|-------|-----|
| `InvalidAccessKeyId` | Wrong access key | Check OCI Console for correct key |
| `InvalidUserID.NotAuthorized` | Wrong secret key | Regenerate and copy correctly |
| `connection refused` | Wrong endpoint URL | Verify endpoint is correct |
| `NoSuchBucket` | Wrong bucket name | Check bucket name is `dpp-prod-files` |
| `Service Unavailable` | Bucket private/no access | Check bucket permissions |

### Files not uploading?

1. Check backend logs: `docker logs docker-backend-api-1 | tail -50`
2. Verify credentials are correct in `/etc/dpp/.env.prod`
3. Ensure bucket `dpp-prod-files` is in OCI console
4. Restart backend: `docker compose -f docker/docker-compose.prod.backend.yml restart backend-api`

---

## Configuration Reference

**Your S3 settings (for reference):**
```
Bucket Name: dpp-prod-files
Namespace: axknlhgrqwn0
Region: eu-stockholm-1
Endpoint URL: https://axknlhgrqwn0.compat.objectstorage.eu-stockholm-1.oci.customer-oci.com
Public Base URL: https://axknlhgrqwn0.compat.objectstorage.eu-stockholm-1.oci.customer-oci.com/dpp-prod-files
```

---

## Next Steps

Once S3 is working:

1. ✅ Test file uploads
2. ✅ Verify files appear in OCI bucket
3. ✅ Update `RUN_SCHEMA_MIGRATIONS=false` in `/etc/dpp/.env.prod` (if not done)
4. ✅ Run database backup procedures
5. ✅ System is production-ready!
