-- Add OAuth provider enum and fields to users table
-- Add token limit fields to plan_features table

-- CreateEnum
CREATE TYPE "OAuthProvider" AS ENUM ('GOOGLE', 'FACEBOOK', 'LINKEDIN', 'TWITTER');

-- AlterTable: Add OAuth fields to users
ALTER TABLE "users" ADD COLUMN "oauthProvider" "OAuthProvider";
ALTER TABLE "users" ADD COLUMN "oauthProviderId" TEXT;
ALTER TABLE "users" ADD COLUMN "oauthProfile" JSONB;

-- AlterTable: Add token limit fields to plan_features
ALTER TABLE "plan_features" ADD COLUMN "monthlyTokenLimit" INTEGER;
ALTER TABLE "plan_features" ADD COLUMN "dailyTokenLimit" INTEGER;

























