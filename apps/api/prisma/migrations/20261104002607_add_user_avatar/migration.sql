-- AlterTable
ALTER TABLE "User" ADD COLUMN     "avatarMimeType" TEXT,
ADD COLUMN     "avatarStorageName" TEXT,
ADD COLUMN     "avatarUpdatedAt" TIMESTAMP(3);
