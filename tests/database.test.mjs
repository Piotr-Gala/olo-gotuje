import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrations = new URL("../supabase/migrations/", import.meta.url);
const readMigration = name => readFileSync(new URL(name, migrations), "utf8");
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
    create table auth.users (id uuid primary key, raw_user_meta_data jsonb);
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
  for (const name of readdirSync(migrations).filter(name => name.endsWith(".sql") && name !== ownerMigration).sort()) {
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
    await db.query("insert into auth.users (id, raw_user_meta_data) values ($1, $2)", [id, { birth_date: "2000-01-01", nickname: "Test account" }]);
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

test("all migrations, existing RLS regression, and future owner protection", async t => {
  const db = await databaseBeforeOwnerMigration();
  try {
    await db.exec(readMigration(ownerMigration));
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

    await t.test("a pending owner remains approvable and approval assigns protection", async () => {
      await asAdmin(db, "update public.profiles set role='owner' where id=$1 returning id", [ids.owner]);
      let profile = (await db.query("select is_primary_owner from public.profiles where id=$1", [ids.owner])).rows[0];
      assert.equal(profile.is_primary_owner, false);
      const result = await asAdmin(db, "update public.profiles set is_approved=true where id=$1 returning is_primary_owner", [ids.owner]);
      assert.equal(result.rows[0].is_primary_owner, true);
    });

    await t.test("an admin cannot demote or suspend the protected owner", async () => {
      assert.equal((await asAdmin(db, "update public.profiles set role='member' where id=$1 returning id", [ids.owner])).rows.length, 0);
      assert.equal((await asAdmin(db, "update public.profiles set is_approved=false where id=$1 returning id", [ids.owner])).rows.length, 0);
    });

    await t.test("other owners remain manageable", async () => {
      const result = await asAdmin(db, "update public.profiles set role='owner', is_approved=true where id=$1 returning is_primary_owner", [ids.other]);
      assert.equal(result.rows[0].is_primary_owner, false);
      assert.equal((await asAdmin(db, "update public.profiles set role='member', is_approved=false where id=$1 returning id", [ids.other])).rows.length, 1);
    });

    await t.test("clients cannot forge the protection flag or edit their own role", async () => {
      await assert.rejects(asAdmin(db, "update public.profiles set is_primary_owner=true where id=$1", [ids.other]), error => error.code === "42501");
      assert.equal((await asAdmin(db, "update public.profiles set role='owner' where id=$1 returning id", [ids.admin])).rows.length, 0);
    });

    await t.test("family profiles expose only safe details to approved members", async () => {
      const pendingId = "10000000-0000-4000-8000-000000000004";
      await db.query("insert into auth.users (id, raw_user_meta_data) values ($1, $2)", [pendingId, { birth_date: "2000-01-01", nickname: "Pending" }]);
      await db.query("update public.profiles set is_approved=true where id=$1", [ids.other]);
      const visible = await asUser(db, ids.other, "select id, display_name, bio from public.family_profiles order by id");
      assert.equal(visible.rows.length, 3);
      assert.deepEqual(visible.rows.map(row => row.id).sort(), [ids.admin, ids.owner, ids.other].sort());
      assert.equal((await asUser(db, pendingId, "select id from public.family_profiles")).rows.length, 0);
      assert.equal((await asUser(db, ids.other, "select id from public.profiles where id=$1", [ids.admin])).rows.length, 0);
    });

    await t.test("members can edit only their family display name and bio", async () => {
      await asUser(db, ids.other, "select public.update_my_family_profile($1, $2)", ["Kuchcik", "Lubię gotować."]);
      const own = (await db.query("select display_name, bio from public.family_profiles where id=$1", [ids.other])).rows[0];
      assert.deepEqual(own, { display_name: "Kuchcik", bio: "Lubię gotować." });
      assert.equal((await asUser(db, ids.other, "update public.family_profiles set display_name='Nie moje' where id=$1 returning id", [ids.admin])).rows.length, 0);
      await assert.rejects(asUser(db, ids.other, "select public.update_my_family_profile($1, $2)", ["", ""]), error => error.code === "22023");
      assert.equal((await asUser(db, ids.other, "update public.profiles set role='admin' where id=$1 returning id", [ids.other])).rows.length, 0);
    });

    await t.test("the database rejects a second primary owner", async () => {
      await assert.rejects(db.query("update public.profiles set is_primary_owner=true where id=$1", [ids.other]), error => error.code === "23505");
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
