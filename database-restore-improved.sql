-- Database Restore Script
-- Generated on 2025-11-18T09:08:54.418Z
-- WARNING: This script will INSERT data. Make sure tables exist first!
-- Run this after applying all migrations: npx prisma migrate deploy


-- Inserting 2 records into tenant
INSERT INTO "tenant" ("id", "name", "atiId", "type", "status", "createdAt", "updatedAt") VALUES ('cmgqg3vzn000051ny1ya55qfu', 'Platform Administration', 'PLATFORM', 'ENTERPRISE', 'ACTIVE', '2025-10-14T10:55:03.347Z', '2025-10-14T10:55:03.347Z');
INSERT INTO "tenant" ("id", "name", "atiId", "type", "status", "createdAt", "updatedAt") VALUES ('cmgqg3wcv000551nyockuewpt', 'Test Company Inc.', 'TESTTENANT', 'ENTERPRISE', 'ACTIVE', '2025-10-14T10:55:03.823Z', '2025-10-14T10:55:03.823Z');

-- Inserting 3 records into user
INSERT INTO "user" ("id", "tenantId", "signupAtiTokenId", "email", "passwordHash", "name", "roles", "status", "emailVerified", "noveltySearchesCompleted", "createdAt", "updatedAt") VALUES ('cmi4cpyie00047r7aqp2s1zqs', 'cmgqg3vzn000051ny1ya55qfu', 'cmi4cpyi000027r7a20hlwydw', 'superadmin@spotipr.com', '$2a$12$QKQz0Uqiom7J5Ridb5z7auJa86oywwuHtnMsLQs9.idRDWBpLpUVi', 'Super Admin', '["SUPER_ADMIN"]', 'ACTIVE', false, 0, '2025-11-18T09:08:43.382Z', '2025-11-18T09:08:43.382Z');
INSERT INTO "user" ("id", "tenantId", "signupAtiTokenId", "email", "passwordHash", "name", "roles", "status", "emailVerified", "noveltySearchesCompleted", "createdAt", "updatedAt") VALUES ('cmi4cpzcw000b7r7ayj2mbv5s', 'cmgqg3wcv000551nyockuewpt', 'cmi4cpyw700097r7axc7l89kn', 'tenantadmin@spotipr.com', '$2a$12$frm.1V2fqujoCHqTn0PW4uAc4aZPPG0dZ6M4j85kY.WyqcQeNxVNu', 'Tenant Admin', '["ADMIN"]', 'ACTIVE', false, 0, '2025-11-18T09:08:44.480Z', '2025-11-18T09:08:44.480Z');
INSERT INTO "user" ("id", "tenantId", "signupAtiTokenId", "email", "passwordHash", "name", "roles", "status", "emailVerified", "noveltySearchesCompleted", "createdAt", "updatedAt") VALUES ('cmi4cq03k000f7r7aqfsnq2ji', 'cmgqg3wcv000551nyockuewpt', 'cmi4cpzqi000d7r7aznleu962', 'analyst@spotipr.com', '$2a$12$H08aRl.lqEabGpwG4TMk8erOVqrVnH3iVXU8E4BMtlHJkkck.cEna', 'Test Analyst', '["ANALYST"]', 'ACTIVE', false, 0, '2025-11-18T09:08:45.440Z', '2025-11-18T09:08:45.440Z');

-- Inserting 3 records into aTIToken
INSERT INTO "aTIToken" ("id", "tenantId", "tokenHash", "rawToken", "rawTokenExpiry", "fingerprint", "status", "maxUses", "usageCount", "planTier", "notes", "createdAt", "updatedAt") VALUES ('cmi4cpyi000027r7a20hlwydw', 'cmgqg3vzn000051ny1ya55qfu', '$2a$12$LyP6wJ9MTDqihDTyDJ26Xu99YFiEDxXkujAeJRySsBJSFbx/9r31u', '27B34B08C269962DE775FF02C797D528157D2746993AEFC746BC00221E06F6A0', '2025-11-19T09:08:43.364Z', '/9R31U', 'ISSUED', 5, 0, 'PLATFORM_ADMIN', 'Super Admin Onboarding Token', '2025-11-18T09:08:43.368Z', '2025-11-18T09:08:43.368Z');
INSERT INTO "aTIToken" ("id", "tenantId", "tokenHash", "rawToken", "rawTokenExpiry", "fingerprint", "status", "maxUses", "usageCount", "planTier", "notes", "createdAt", "updatedAt") VALUES ('cmi4cpyw700097r7axc7l89kn', 'cmgqg3wcv000551nyockuewpt', '$2a$12$ndODVaaLxiNezHr5/5WXtunR/5nJ.xoSqWFIGdly7I8Vb8vpJmnD2', 'D63FEA3F297C96218C83C3B384138E37959828BAF61347AD241C8E5EE1D7999F', '2025-11-19T09:08:43.875Z', 'PJMND2', 'ISSUED', 5, 0, 'PRO_PLAN', 'Tenant Admin Onboarding Token', '2025-11-18T09:08:43.879Z', '2025-11-18T09:08:43.879Z');
INSERT INTO "aTIToken" ("id", "tenantId", "tokenHash", "rawToken", "rawTokenExpiry", "fingerprint", "status", "maxUses", "usageCount", "planTier", "notes", "createdAt", "updatedAt") VALUES ('cmi4cpzqi000d7r7aznleu962', 'cmgqg3wcv000551nyockuewpt', '$2a$12$5Cql6piy3T3qU6e8tWLwleRr6SnOKAVeCMA4Lzb3LouNricMyhYXC', '4769987C5B61B8D19551CBBCF97F6E123F8CD0C5E2A605733C843898E2D578AD', '2025-11-19T09:08:44.968Z', 'MYHYXC', 'ISSUED', 10, 0, 'PRO_PLAN', 'Analyst Onboarding Token', '2025-11-18T09:08:44.970Z', '2025-11-18T09:08:44.970Z');

-- Inserting 2 records into plan
INSERT INTO "plan" ("id", "code", "name", "cycle", "status", "createdAt", "updatedAt") VALUES ('cmgqh9rd10000xjnkvgb2w8xp', 'PRO_PLAN', 'Professional Plan', 'MONTHLY', 'ACTIVE', '2025-10-14T11:27:36.901Z', '2025-10-14T11:27:36.901Z');
INSERT INTO "plan" ("id", "code", "name", "cycle", "status", "createdAt", "updatedAt") VALUES ('cmgsxqrvo0008ga9ht3wd56lt', 'FREE_PLAN', 'Free Plan', 'MONTHLY', 'ACTIVE', '2025-10-16T04:44:16.933Z', '2025-10-16T04:44:16.933Z');

-- Inserting 3 records into tenantPlan
INSERT INTO "tenantPlan" ("id", "tenantId", "planId", "effectiveFrom", "expiresAt", "status", "createdAt") VALUES ('cmgqhbkku0001nayyg9nqukab', 'cmgqg3wcv000551nyockuewpt', 'cmgqh9rd10000xjnkvgb2w8xp', '2025-10-14T11:29:01.420Z', '2026-10-14T11:29:01.420Z', 'ACTIVE', '2025-10-14T11:29:01.422Z');
INSERT INTO "tenantPlan" ("id", "tenantId", "planId", "effectiveFrom", "status", "createdAt") VALUES ('cmgsxqrzv000pga9hhpl13nzj', 'cmgqg3vzn000051ny1ya55qfu', 'cmgsxqrvo0008ga9ht3wd56lt', '2025-10-16T04:44:17.080Z', 'ACTIVE', '2025-10-16T04:44:17.084Z');
INSERT INTO "tenantPlan" ("id", "tenantId", "planId", "effectiveFrom", "status", "createdAt") VALUES ('cmi4cpyiz00077r7atq82meas', 'cmgqg3wcv000551nyockuewpt', 'cmgqh9rd10000xjnkvgb2w8xp', '2025-11-18T09:08:43.401Z', 'ACTIVE', '2025-11-18T09:08:43.403Z');

-- Inserting 2 records into feature
INSERT INTO "feature" ("id", "code", "name", "unit") VALUES ('cmgqhkja80002bia0toz0lscz', 'PRIOR_ART_SEARCH', 'Prior Art Search', 'calls');
INSERT INTO "feature" ("id", "code", "name", "unit") VALUES ('cmgqhlbku00008z31jvf2fz2y', 'PATENT_DRAFTING', 'Patent Drafting', 'tokens');

-- Inserting 4 records into planFeature
INSERT INTO "planFeature" ("id", "planId", "featureId", "monthlyQuota", "dailyQuota") VALUES ('cmgsxqrw0000cga9h6jai1fuu', 'cmgsxqrvo0008ga9ht3wd56lt', 'cmgqhkja80002bia0toz0lscz', 50, 5);
INSERT INTO "planFeature" ("id", "planId", "featureId", "monthlyQuota", "dailyQuota") VALUES ('cmgsxqrw0000dga9hdcw1250b', 'cmgsxqrvo0008ga9ht3wd56lt', 'cmgqhlbku00008z31jvf2fz2y', 1000, 100);
INSERT INTO "planFeature" ("id", "planId", "featureId", "monthlyQuota", "dailyQuota") VALUES ('cmgsxqryx000fga9hkl3dxm2z', 'cmgqh9rd10000xjnkvgb2w8xp', 'cmgqhlbku00008z31jvf2fz2y', 50000, 5000);
INSERT INTO "planFeature" ("id", "planId", "featureId", "monthlyQuota", "dailyQuota") VALUES ('cmgsxqrz1000hga9hsmjr94vq', 'cmgqh9rd10000xjnkvgb2w8xp', 'cmgqhkja80002bia0toz0lscz', 1000, 100);
