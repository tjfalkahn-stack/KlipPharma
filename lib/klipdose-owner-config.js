export function klipdoseOwnerConfigForRequest(req) {
  if (req.team?.businessActive && req.team.ownerUserId) {
    return {
      klipdoseProjectOwnerId: req.team.ownerUserId,
      source: "workspaces.owner_user_id",
      workspaceId: req.team.id,
    };
  }
  return {
    klipdoseProjectOwnerId: req.user?.id || null,
    source: "users.id",
    workspaceId: req.team?.id || null,
  };
}
