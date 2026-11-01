import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrations = new URL("../supabase/migrations/", import.meta.url);
const readMigration = name => readFileSync(new URL(name, migrations), "utf8");
const loginMigration = readdirSync(migrations).find(name => name.endsWith("_simplify_owner_and_nickname_login.sql"));
const accountMigration = readdirSync(migrations).find(name => name.endsWith("_editable_account_nickname.sql"));
const ownerMigration = readdirSync(migrations).find(name => name.endsWith("_protect_future_primary_owner.sql"));

async function databaseBeforeOwnerMigration() {
  const db = await PGlite.create();
  // Minimal Supabase-managed interfaces; application tables, grants and policies
  // come exclusively from the actual migration files.
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key, raw_user_meta_data jsonb, email text);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, unique (bucket_id, name));
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql immutable as $$
      select string_to_array(regexp_replace(name, '/[^/]*$', ''), '/')
    $$;
    grant usage on schema storage to authenticated;
    grant all on storage.objects to authenticated;
  `);
  for (const name of readdirSync(migrations).filter(name => name.endsWith(".sql") && name !== ownerMigration && name !== loginMigration && name !== accountMigration).sort()) {
    await db.exec(readMigration(name));
  }
  return db;
}

const ids = {
  admin: "10000000-0000-4000-8000-000000000001",
  owner: "10000000-0000-4000-8000-000000000002",
  other: "10000000-0000-4000-8000-000000000003",
};

async function seedAccounts(db) {
  for (const id of Object.values(ids)) {
    await db.query("insert into auth.users (id, raw_user_meta_data) values ($1, $2)", [id, { birth_date: "2000-01-01", nickname: `T${id}` }]);
  }
  await db.query("update public.profiles set role='admin', is_approved=true where id=$1", [ids.admin]);
}

async function asAdmin(db, sql, params = []) {
  return asUser(db, ids.admin, sql, params);
}

async function asUser(db, userId, sql, params = []) {
  return db.transaction(async tx => {
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    await tx.exec("set local role authenticated");
    return tx.query(sql, params);
  });
}

test("all migrations, existing RLS regression, and manageable owner roles", async t => {
  const db = await databaseBeforeOwnerMigration();
  try {
    await db.exec(readMigration(ownerMigration));
    await db.exec(readMigration(loginMigration));
    await db.exec(readMigration(accountMigration));
    await db.exec(readFileSync(new URL("../supabase/tests/private_rls_helpers.sql", import.meta.url), "utf8"));
    await seedAccounts(db);

    await t.test("retry upserts and cleanup after cascade are allowed by actual RLS", async () => {
      const postId = "20000000-0000-4000-8000-000000000001";
      const imageId = "20000000-0000-4000-8000-000000000002";
      const path = `${postId}/image.png`;
      for (let attempt = 0; attempt < 2; attempt++) {
        await asAdmin(db, "insert into public.posts (id, section_slug, author_id, title, slug) values ($1, 'gotowanie', $2, 'Retry test', 'retry-test') on conflict (id) do nothing", [postId, ids.admin]);
        await asAdmin(db, "insert into storage.objects (bucket_id, name) values ('family-post-images', $1) on conflict (bucket_id, name) do update set name=excluded.name", [path]);
        await asAdmin(db, "insert into public.post_images (id, post_id, storage_path) values ($1, $2, $3) on conflict (id) do update set storage_path=excluded.storage_path", [imageId, postId, path]);
      }
      assert.equal((await db.query("select count(*)::int as total from public.post_images where post_id=$1", [postId])).rows[0].total, 1);
      assert.equal((await asAdmin(db, "delete from public.posts where id=$1 returning id", [postId])).rows.length, 1);
      assert.equal((await asAdmin(db, "delete from storage.objects where bucket_id='family-post-images' and name=$1 returning name", [path])).rows.length, 1);
    });

    await t.test("admins can approve, suspend and demote every owner but cannot edit themselves", async () => {
      for (const id of [ids.owner, ids.other]) {
        assert.equal((await asAdmin(db, "update public.profiles set role='owner', is_approved=true where id=$1 returning id", [id])).rows.length, 1);
        assert.equal((await asAdmin(db, "update public.profiles set role='member', is_approved=false where id=$1 returning id", [id])).rows.length, 1);
      }
      await asAdmin(db, "update public.profiles set role='owner', is_approved=true where id=$1", [ids.owner]);
      assert.equal((await asAdmin(db, "update public.profiles set role='owner' where id=$1 returning id", [ids.admin])).rows.length, 0);
    });

    await t.test("nickname resolution is private, case insensitive, and unique", async () => {
      await db.query("update public.profiles set nickname='Olo' where id=$1", [ids.owner]);
      await db.query("update auth.users set email='olo@accounts.olo.invalid' where id=$1", [ids.owner]);
      assert.equal((await db.query("select public.login_user_for_nickname(' OLO ') as email")).rows[0].email, ids.owner);
      assert.equal((await db.query("select public.login_user_for_nickname('missing') as email")).rows[0].email, null);
      await assert.rejects(asAdmin(db, "select public.login_user_for_nickname('Olo')"), error => error.code === "42501");
      await assert.rejects(db.transaction(async tx => { await tx.exec("set local role anon"); await tx.exec("select public.login_user_for_nickname('Olo')"); }), error => error.code === "42501");
      await assert.rejects(db.query("update public.profiles set nickname=' olo ' where id=$1", [ids.other]), error => error.code === "23505");
    });
    await t.test("family profiles expose only safe details to approved members", async () => {
      const pendingId = "10000000-0000-4000-8000-000000000004";
      await db.query("insert into auth.users (id, raw_user_meta_data) values ($1, $2)", [pendingId, { birth_date: "2000-01-01", nickname: "Pending" }]);
      await db.query("update public.profiles set is_approved=true where id=$1", [ids.other]);
      const visible = await asUser(db, ids.other, "select id, display_name, bio from public.family_profiles order by id");
      assert.equal(visible.rows.length, 3);
      assert.deepEqual(visible.rows.map(row => row.id).sort(), [ids.admin, ids.owner, ids.other].sort());
      assert.deepEqual((await asUser(db, pendingId, "select id from public.family_profiles")).rows.map(row => row.id), [pendingId]);
      assert.equal((await asUser(db, ids.other, "select id from public.profiles where id=$1", [ids.admin])).rows.length, 0);
    });

    await t.test("members can edit only their family display name and bio", async () => {
      await asUser(db, ids.other, "select public.update_my_family_profile($1, $2)", ["Kuchcik", "Lubię gotować."]);
      const own = (await db.query("select display_name, bio from public.family_profiles where id=$1", [ids.other])).rows[0];
      assert.deepEqual(own, { display_name: "Kuchcik", bio: "Lubię gotować." });
      assert.equal((await db.query("select nickname from public.profiles where id=$1", [ids.other])).rows[0].nickname, "Kuchcik");
      assert.equal((await db.query("select public.login_user_for_nickname(' KUCHCIK ') as id")).rows[0].id, ids.other);
      const roleBefore = (await db.query("select role from public.profiles where id=$1", [ids.other])).rows[0].role;
      await assert.rejects(asUser(db, ids.other, "select public.update_my_family_profile(' oLO ', 'Must roll back')"), error => error.code === "23505");
      assert.deepEqual((await db.query("select display_name,bio from public.family_profiles where id=$1", [ids.other])).rows[0], own);
      await assert.rejects(asUser(db, ids.other, "select public.update_my_family_profile('user@example.com', '')"), error => error.code === "22023");
      assert.equal((await db.query("select role from public.profiles where id=$1", [ids.other])).rows[0].role, roleBefore);
      assert.equal((await asUser(db, ids.other, "update public.family_profiles set display_name='Nie moje' where id=$1 returning id", [ids.admin])).rows.length, 0);
      await assert.rejects(asUser(db, ids.other, "select public.update_my_family_profile($1, $2)", ["", ""]), error => error.code === "22023");
      assert.equal((await asUser(db, ids.other, "update public.profiles set role='admin' where id=$1 returning id", [ids.other])).rows.length, 0);
    });

    await t.test("pending members can rename themselves without gaining family access", async () => {
      const pendingId = "10000000-0000-4000-8000-000000000004";
      await asUser(db, pendingId, "select public.update_my_family_profile('Pending renamed', '')");
      assert.equal((await asUser(db, pendingId, "select id from public.family_profiles")).rows.length, 1);
      assert.equal((await asUser(db, pendingId, "select id from public.posts")).rows.length, 0);
      const profile = (await db.query("select nickname,role,is_approved from public.profiles where id=$1", [pendingId])).rows[0];
      assert.deepEqual(profile, { nickname: "Pending renamed", role: "member", is_approved: false });
    });

    await t.test("avatars enforce ownership, privacy and crop bounds", async () => {
      const ownPath = `${ids.other}/avatar.webp`;
      const otherPath = `${ids.admin}/avatar.webp`;
      await asUser(db, ids.other, "insert into storage.objects(bucket_id,name) values('family-avatars',$1)", [ownPath]);
      await asAdmin(db, "insert into storage.objects(bucket_id,name) values('family-avatars',$1)", [otherPath]);
      await asUser(db, ids.other, "select public.update_my_avatar($1,20,75,1.8)", [ownPath]);
      const crop = (await db.query("select avatar_path,avatar_x,avatar_y,avatar_zoom::float as zoom from public.family_profiles where id=$1", [ids.other])).rows[0];
      assert.deepEqual(crop, { avatar_path: ownPath, avatar_x: 20, avatar_y: 75, zoom: 1.8 });
      await assert.rejects(asUser(db, ids.other, "select public.update_my_avatar($1,50,50,1)", [otherPath]), error => error.code === "42501");
      await assert.rejects(asUser(db, ids.other, "select public.update_my_avatar($1,101,50,1)", [ownPath]), error => error.code === "22023");
      await assert.rejects(asUser(db, ids.other, "select public.update_my_avatar($1,50,50,'NaN')", [ownPath]), error => error.code === "22023");
      await assert.rejects(asUser(db, ids.other, "insert into storage.objects(bucket_id,name) values('family-avatars',$1)", [`${ids.admin}/forged.webp`]), error => error.code === "42501");
      assert.equal((await asUser(db, ids.owner, "select name from storage.objects where bucket_id='family-avatars' and name=$1", [ownPath])).rows.length, 1);
      assert.equal((await asUser(db, '10000000-0000-4000-8000-000000000004', "select name from storage.objects where bucket_id='family-avatars'")).rows.length, 0);
      assert.equal((await asUser(db, ids.owner, "delete from storage.objects where bucket_id='family-avatars' and name=$1 returning name", [ownPath])).rows.length, 0);
      const pendingId = '10000000-0000-4000-8000-000000000004';
      const pendingPath = `${pendingId}/pending.webp`;
      await asUser(db, pendingId, "insert into storage.objects(bucket_id,name) values('family-avatars',$1)", [pendingPath]);
      await asUser(db, pendingId, "select public.update_my_avatar($1,50,50,1)", [pendingPath]);
      assert.equal((await asUser(db, ids.other, "select name from storage.objects where bucket_id='family-avatars' and name=$1", [pendingPath])).rows.length, 0);
      await assert.rejects(asUser(db, ids.other, "update public.family_profiles set avatar_path=$1 where id=$2", [otherPath, ids.other]), error => error.code === "42501");
    });

    await t.test("likes and comments enforce identity, visibility, moderation and cascade", async () => {
      const postId = "50000000-0000-4000-8000-000000000001";
      const pendingId = "10000000-0000-4000-8000-000000000004";
      await asAdmin(db, "insert into public.posts(id,section_slug,author_id,title,slug,status) values($1,'gotowanie',$2,'Discussion','discussion-test','published')", [postId, ids.admin]);
      await asAdmin(db, "update public.sections set is_active=true where slug='gotowanie'");
      await asUser(db, ids.other, "insert into public.post_likes(post_id) values($1)", [postId]);
      await assert.rejects(asUser(db, ids.other, "insert into public.post_likes(post_id) values($1)", [postId]), error => error.code === "23505");
      await assert.rejects(asUser(db, ids.other, "insert into public.post_likes(post_id,user_id) values($1,$2)", [postId, ids.owner]), error => error.code === "42501");
      assert.equal((await asAdmin(db, "delete from public.post_likes where post_id=$1 returning user_id", [postId])).rows.length, 0);
      const commentId = (await asUser(db, ids.other, "insert into public.post_comments(post_id,content) values($1,'Hello family') returning id", [postId])).rows[0].id;
      await assert.rejects(asUser(db, ids.other, "insert into public.post_comments(post_id,author_id,content) values($1,$2,'Impersonation')", [postId, ids.owner]), error => error.code === "42501");
      await assert.rejects(asUser(db, ids.other, "insert into public.post_comments(post_id,content) values($1,'   ')", [postId]), error => error.code === "23514");
      await assert.rejects(asUser(db, ids.other, "insert into public.post_comments(post_id,content) values($1,$2)", [postId, 'x'.repeat(2001)]), error => error.code === "23514");
      await assert.rejects(asUser(db, pendingId, "insert into public.post_comments(post_id,content) values($1,'Pending')", [postId]), error => error.code === "42501");
      assert.equal((await asUser(db, pendingId, "select id from public.post_comments")).rows.length, 0);
      assert.equal((await asUser(db, ids.owner, "select id from public.post_comments where post_id=$1", [postId])).rows.length, 1);
      await asAdmin(db, "update public.sections set is_active=false where slug='gotowanie'");
      assert.equal((await asUser(db, ids.other, "select id from public.post_comments")).rows.length, 0);
      assert.equal((await asUser(db, ids.other, "select user_id from public.post_likes")).rows.length, 0);
      await assert.rejects(asUser(db, ids.other, "insert into public.post_comments(post_id,content) values($1,'Hidden')", [postId]), error => error.code === "42501");
      await asAdmin(db, "update public.sections set is_active=true where slug='gotowanie'");
      await db.query("update public.profiles set is_approved=true where id=$1", [pendingId]);
      assert.equal((await asUser(db, pendingId, "delete from public.post_comments where id=$1 returning id", [commentId])).rows.length, 0);
      assert.equal((await asUser(db, ids.owner, "delete from public.post_comments where id=$1 returning id", [commentId])).rows.length, 1);
      const ownComment = (await asUser(db, ids.other, "insert into public.post_comments(post_id,content) values($1,'Own') returning id", [postId])).rows[0].id;
      assert.equal((await asUser(db, ids.other, "delete from public.post_comments where id=$1 returning id", [ownComment])).rows.length, 1);
      await asUser(db, ids.other, "insert into public.post_comments(post_id,content) values($1,'Cascade')", [postId]);
      await asAdmin(db, "delete from public.posts where id=$1", [postId]);
      assert.equal((await db.query("select id from public.post_comments where post_id=$1", [postId])).rows.length, 0);
      assert.equal((await db.query("select user_id from public.post_likes where post_id=$1", [postId])).rows.length, 0);
      await db.query("update public.profiles set is_approved=false where id=$1", [pendingId]);
    });

    await t.test("video RLS follows post visibility and cascade retains cleanup identities", async () => {
      const postId = "40000000-0000-4000-8000-000000000001";
      const videoId = "40000000-0000-4000-8000-000000000002";
      await asAdmin(db, "insert into public.posts (id, section_slug, author_id, title, slug) values ($1, 'gotowanie', $2, 'Video', 'video-rls')", [postId, ids.admin]);
      await asAdmin(db, "insert into public.post_videos(id, post_id, file_name, size_bytes) values ($1, $2, 'test.mp4', 40)", [videoId, postId]);
      assert.equal((await asUser(db, ids.other, "select id from public.post_videos")).rows.length, 0);
      await asAdmin(db, "update public.post_videos set state='ready' where id=$1", [videoId]);
      assert.equal((await asUser(db, ids.other, "select id from public.post_videos")).rows.length, 0);
      await asAdmin(db, "update public.posts set status='published' where id=$1", [postId]);
      await asAdmin(db, "update public.sections set is_active=true where slug='gotowanie'");
      assert.equal((await asUser(db, ids.other, "select id from public.post_videos")).rows.length, 1);
      assert.equal((await asUser(db, '10000000-0000-4000-8000-000000000004', "select id from public.post_videos")).rows.length, 0);
      await assert.rejects(asUser(db, ids.other, "insert into public.post_videos(id,post_id,file_name,size_bytes) values(gen_random_uuid(), $1, 'bad.mp4', 40)", [postId]), error => error.code === "42501");
      assert.equal((await asUser(db, ids.other, "update public.post_videos set state='deleting' returning id")).rows.length, 0);
      assert.equal((await asUser(db, ids.other, "delete from public.post_videos returning id")).rows.length, 0);
      await assert.rejects(db.transaction(async tx => { await tx.exec("set local role anon"); await tx.exec("select * from public.post_videos"); }), error => error.code === "42501");
      await asAdmin(db, "update public.sections set is_active=false where slug='gotowanie'");
      assert.equal((await asUser(db, ids.other, "select id from public.post_videos")).rows.length, 0);
      assert.equal((await asUser(db, ids.owner, "select id from public.post_videos")).rows.length, 1);
      await assert.rejects(asAdmin(db, "update public.post_videos set size_bytes=1000000001 where id=$1", [videoId]), error => error.code === "23514");
      assert.equal((await asAdmin(db, "delete from public.post_videos where id=$1 returning id", [videoId])).rows.length, 0);
      await asAdmin(db, "delete from public.posts where id=$1", [postId]);
      const orphan = (await asAdmin(db, "select * from public.post_videos where id=$1", [videoId])).rows[0];
      assert.equal(orphan.post_id, null); assert.equal(orphan.state, "deleting");
      assert.equal(orphan.object_key, `videos/${videoId}.mp4`);
      assert.ok(new Date(orphan.cleanup_after).getTime() > Date.now());
      assert.equal((await asUser(db, ids.other, "select id from public.post_videos")).rows.length, 0);
      await asAdmin(db, "update public.sections set is_active=true where slug='gotowanie'");
    });

  } finally {
    await db.close();
  }
});

test("the migration protects an approved owner that already exists", async () => {
  const db = await databaseBeforeOwnerMigration();
  try {
    await seedAccounts(db);
    await db.query("update public.profiles set role='owner', is_approved=true where id=$1", [ids.owner]);
    await db.exec(readMigration(ownerMigration));
    const result = await db.query("select is_primary_owner from public.profiles where id=$1", [ids.owner]);
    assert.equal(result.rows[0].is_primary_owner, true);
  } finally {
    await db.close();
  }
});
