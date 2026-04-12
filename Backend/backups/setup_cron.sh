#!/bin/bash
# Install/update the auto-backup cron job (every 6 hours)
# Run this once on your server: ./setup_cron.sh
# To remove: ./setup_cron.sh --remove

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKUP_SCRIPT="${SCRIPT_DIR}/auto_backup.sh"
CRON_COMMENT="# dpp_system auto backup"
CRON_SCHEDULE="17 */6 * * *"
CRON_LINE="${CRON_SCHEDULE} ${BACKUP_SCRIPT}"

if [ "$1" = "--remove" ]; then
  crontab -l 2>/dev/null | grep -v "auto_backup.sh" | grep -v "$CRON_COMMENT" | crontab -
  echo "Cron job removed."
  exit 0
fi

chmod +x "$BACKUP_SCRIPT"

# Remove old entry if exists, then add new one
(crontab -l 2>/dev/null | grep -v "auto_backup.sh" | grep -v "$CRON_COMMENT"; echo "$CRON_COMMENT"; echo "$CRON_LINE") | crontab -

if [ $? -eq 0 ]; then
  echo "Cron job installed successfully."
  echo "Schedule: every 6 hours (at :17 past)"
  echo "Script:   ${BACKUP_SCRIPT}"
  echo ""
  echo "Current crontab:"
  crontab -l 2>/dev/null | grep -A1 "dpp_system"
  echo ""
  echo "To remove: $0 --remove"
  echo "To test now: ${BACKUP_SCRIPT}"
else
  echo "ERROR: Failed to install cron job."
  echo "You may need to run: sudo chmod u+s /usr/bin/crontab"
  exit 1
fi
