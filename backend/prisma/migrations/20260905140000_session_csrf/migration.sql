-- Existing sessions rotate into CSRF protection on their next authenticated GET.
ALTER TABLE "Session" ADD COLUMN "csrfHash" TEXT;
