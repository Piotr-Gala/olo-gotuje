import assert from "node:assert/strict";
import test from "node:test";
import { loadTypeScript } from "./load-typescript.mjs";

const { changeOwnPassword } = await loadTypeScript("../src/lib/account-password.ts");

function fixture({ wrongPassword = false, updateError = null, otherUser = false } = {}) {
  const calls = [];
  return { calls, client: { auth: {
    getUser: async () => ({ data: { user: { id: "own-id", email: "private@example.invalid" } }, error: null }),
    signInWithPassword: async input => {
      calls.push(["verify", input]);
      return { data: { user: { id: otherUser ? "other-id" : "own-id" } }, error: wrongPassword ? { code: "invalid_credentials" } : null };
    },
    updateUser: async input => { calls.push(["update", input]); return { error: updateError }; },
  } } };
}

test("invalid new passwords cannot reach Auth", async () => {
  const { client, calls } = fixture();
  assert.equal(await changeOwnPassword(client, "old-password", "new-password", "different"), "passwordMismatch");
  assert.equal(await changeOwnPassword(client, "old-password", "short", "short"), "passwordShort");
  assert.equal(await changeOwnPassword(client, "old-password", "old-password", "old-password"), "passwordUnchanged");
  assert.equal(await changeOwnPassword(client, "", "new-password", "new-password"), "currentPasswordRequired");
  assert.deepEqual(calls, []);
});

test("wrong old password or mismatched identity prevents the password update", async () => {
  for (const options of [{ wrongPassword: true }, { otherUser: true }]) {
    const { client, calls } = fixture(options);
    assert.equal(await changeOwnPassword(client, "wrong-password", "new-password", "new-password"), "currentPasswordInvalid");
    assert.deepEqual(calls.map(call => call[0]), ["verify"]);
  }
});

test("a verified old password updates only the authenticated account", async () => {
  const { client, calls } = fixture();
  assert.equal(await changeOwnPassword(client, "old-password", "new-password", "new-password"), "passwordChanged");
  assert.deepEqual(calls, [
    ["verify", { email: "private@example.invalid", password: "old-password" }],
    ["update", { password: "new-password", current_password: "old-password" }],
  ]);
});

test("Auth rejection is reported instead of claiming a successful update", async () => {
  for (const [code, expected] of [["weak_password", "weakPassword"], ["unexpected_failure", "passwordChangeFailed"]]) {
    const { client } = fixture({ updateError: { code } });
    assert.equal(await changeOwnPassword(client, "old-password", "new-password", "new-password"), expected);
  }
});
