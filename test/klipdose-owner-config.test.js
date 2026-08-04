import test from "node:test";
import assert from "node:assert/strict";
import { klipdoseOwnerConfigForRequest } from "../lib/klipdose-owner-config.js";

test("uses users.id for a normal account owner", () => {
  assert.deepEqual(klipdoseOwnerConfigForRequest({ user: { id: "user-1" } }), {
    klipdoseProjectOwnerId: "user-1",
    source: "users.id",
    workspaceId: null,
  });
});

test("uses workspaces.owner_user_id for an active Business workspace", () => {
  assert.deepEqual(klipdoseOwnerConfigForRequest({
    user: { id: "member-1" },
    team: { id: "workspace-1", businessActive: true, ownerUserId: "owner-1" },
  }), {
    klipdoseProjectOwnerId: "owner-1",
    source: "workspaces.owner_user_id",
    workspaceId: "workspace-1",
  });
});
