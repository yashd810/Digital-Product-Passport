import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const backupScript = path.join(testDir, "db-backup.sh");

test("database backup staging preserves the backend capability boundary", () => {
  const source = readFileSync(backupScript, "utf8");

  assert.match(source, /assert_private_backend_directory "\$BACKEND_BACKUP_DIR"/);
  assert.match(source, /fs\.constants\.O_NOFOLLOW/);
  assert.doesNotMatch(source, /O_NOFOLLOW \|\| 0/);
  assert.match(source, /stat\.uid !== process\.getuid\(\)/);
  assert.match(source, /stat\.mode & 0o077/);
  assert.match(source, /docker exec -i "\$BACKEND_CONTAINER" node -e/);
  assert.doesNotMatch(source, /docker exec -u 0 "\$BACKEND_CONTAINER"/);
  assert.doesNotMatch(source, /docker cp "\$source" "\$BACKEND_CONTAINER:/);
  assert.match(source, /docker exec -u postgres "\$POSTGRES_CONTAINER" sh -c 'umask 077; mktemp/);
  assert.match(source, /docker exec -i -u postgres "\$POSTGRES_CONTAINER" sh -c 'cat > "\$1"; chmod 0600 "\$1"'/);
  assert.match(source, /docker exec -u postgres "\$POSTGRES_CONTAINER" pg_dump/);
  assert.match(source, /createdb -U "\$DB_USER" --maintenance-db="\$DB_NAME" --template=template0 "\$POSTGRES_RESTORE_DATABASE"/);
  assert.match(source, /--exit-on-error/);
  assert.match(source, /--single-transaction/);
  assert.match(source, /dropdb -U "\$DB_USER" --maintenance-db="\$DB_NAME" --if-exists "\$POSTGRES_RESTORE_DATABASE"/);
  assert.match(source, /restoredPublicTableCount/);
});
