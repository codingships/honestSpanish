-- ============================================
-- RESET DATABASE USERS - Español Honesto
-- ============================================
-- Run this in Supabase SQL Editor
-- 
-- This script:
-- 1. Deletes all existing data that depends on users
-- 2. Deletes users from auth.users (cascades to profiles)
-- 3. Creates new users with correct roles
-- ============================================

-- Step 1: Delete dependent data first (in order of dependencies)
-- Sessions depend on profiles
DELETE FROM sessions;

-- Student-teacher relationships
DELETE FROM student_teachers;

-- Subscriptions depend on profiles
DELETE FROM subscriptions;

-- Step 2: Delete all profiles (this should cascade from auth.users but let's be safe)
DELETE FROM profiles;

-- Step 3: Delete all auth users
-- NOTE: This requires service_role key or running from Supabase Dashboard SQL Editor
DELETE FROM auth.users;

-- ============================================
-- Now create new users via the Supabase Auth UI
-- or use the auth.admin functions below
-- ============================================

-- IMPORTANT: After running the DELETE statements above,
-- you need to CREATE users through:
--
-- Option A: Supabase Dashboard
-- 1. Go to Authentication > Users
-- 2. Click "Add user"
-- 3. Create each user with:
--    - alejandro@espanolhonesto.com / 123456 (then set role = admin in profiles)
--    - alindev95@gmail.com / 123456 (then set role = teacher in profiles)
--    - alinandrei74@gmail.com / 123456 (then set role = student in profiles)
--
-- Option B: After creating users via signup, update their roles:

-- UPDATE profiles SET role = 'admin' WHERE email = 'alejandro@espanolhonesto.com';
-- UPDATE profiles SET role = 'teacher' WHERE email = 'alindev95@gmail.com';
-- UPDATE profiles SET role = 'student' WHERE email = 'alinandrei74@gmail.com';

-- ============================================
-- To create a test subscription for the student:
-- (Run after creating users)
-- ============================================

-- First, get the package ID for 'intensive'
-- SELECT id FROM packages WHERE name = 'intensive';

-- Then insert subscription (replace IDs accordingly):
-- INSERT INTO subscriptions (student_id, package_id, status, sessions_total, sessions_used, starts_at, ends_at)
-- SELECT 
--     p.id,
--     pkg.id,
--     'active',
--     6,
--     0,
--     NOW(),
--     NOW() + INTERVAL '30 days'
-- FROM profiles p, packages pkg
-- WHERE p.email = 'alinandrei74@gmail.com' 
-- AND pkg.name = 'intensive';

-- ============================================
-- Assign teacher to student
-- ============================================

-- INSERT INTO student_teachers (student_id, teacher_id, is_primary)
-- SELECT 
--     s.id,
--     t.id,
--     true
-- FROM profiles s, profiles t
-- WHERE s.email = 'alinandrei74@gmail.com' 
-- AND t.email = 'alindev95@gmail.com';
