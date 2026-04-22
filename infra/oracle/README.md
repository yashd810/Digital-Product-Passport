# Oracle Cloud Free Tier Deployment

The easiest Oracle Cloud Free Tier deployment path for this project is:

- `OCI Compute` Always Free VM for the app containers
- `OCI Object Storage` for uploaded files / symbols / repository assets
- `PostgreSQL container on the VM` for now

This keeps the stack very close to your current Docker setup and avoids a larger platform rewrite.

## What this folder gives you

- [cloud-init.yaml](./cloud-init.yaml)
  Bootstraps an Ubuntu VM with Docker, Git, and the app folder.
- [bootstrap.sh](./bootstrap.sh)
  Server-side deployment helper. Run this on the VM after your `.env.prod` is in place.
- [oci.env.example](./oci.env.example)
  Example production env values tailored for OCI Object Storage.

## Recommended OCI setup

1. Create an `Ampere A1` Ubuntu instance in your home region.
2. Give it a public IP.
3. Open these ingress ports in the subnet / NSG:
   - `22` for SSH
   - `80` if you will reverse proxy later
   - `443` if you will reverse proxy later
   - `3000`, `3001`, `3003`, `3004`, `8080` only if you want direct access temporarily
4. Attach enough block storage for Docker volumes.
5. Create an OCI Object Storage bucket.
6. Create an OCI `Customer Secret Key` for S3-compatible access.

## OCI Object Storage values

Use OCI's S3 Compatibility API.

You will need:

- `namespace`
- `region`
- `bucket`
- `access key`
- `secret key`

Set these in `.env.prod`:

```env
STORAGE_PROVIDER=s3
STORAGE_S3_REGION=<your-region>
STORAGE_S3_BUCKET=<your-bucket>
STORAGE_S3_ACCESS_KEY_ID=<customer-secret-access-key-id>
STORAGE_S3_SECRET_ACCESS_KEY=<customer-secret-secret-key>
STORAGE_S3_ENDPOINT=https://<namespace>.compat.objectstorage.<region>.oci.customer-oci.com
STORAGE_S3_PUBLIC_BASE_URL=https://<namespace>.compat.objectstorage.<region>.oci.customer-oci.com/<your-bucket>
STORAGE_S3_FORCE_PATH_STYLE=true
```

## Minimal deployment flow

1. Create the VM in OCI.
2. Use [cloud-init.yaml](./cloud-init.yaml) as the instance initialization script.
3. SSH into the VM.
4. Copy your local `.env.prod` to the VM:

```bash
scp -i <your-key>.pem .env.prod ubuntu@<vm-public-ip>:/opt/dpp/.env.prod
```

5. On the VM, run:

```bash
cd /opt/dpp
./infra/oracle/bootstrap.sh
```

That will:

- install/update Docker tooling if needed
- clone or update the repo
- verify `.env.prod` exists
- start the production stack with `docker compose -f docker-compose.prod.yml --env-file .env.prod up --build -d`

## Notes

- This setup keeps Postgres inside Docker on the VM. If later you move DB off-instance, only `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME` need to change.
- The app is already prepared for S3-compatible object storage, so OCI Object Storage works through the same `STORAGE_S3_*` config surface.
- For a cleaner public setup later, add a reverse proxy and TLS on `80/443` with subdomains such as:
  - `app.example.com`
  - `api.example.com`
  - `viewer.example.com`
  - `assets.example.com`
