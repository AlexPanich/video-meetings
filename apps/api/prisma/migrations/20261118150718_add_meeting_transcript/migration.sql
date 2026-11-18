-- AlterEnum
ALTER TYPE "SummaryStatus" ADD VALUE 'transcribing';

-- CreateTable
CREATE TABLE "MeetingTranscript" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "storageName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "language" TEXT,
    "duration" DOUBLE PRECISION,
    "segments" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingTranscript_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MeetingTranscript_fileId_key" ON "MeetingTranscript"("fileId");

-- AddForeignKey
ALTER TABLE "MeetingTranscript" ADD CONSTRAINT "MeetingTranscript_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "MeetingFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
