import { adminApi, classApi, orgsApi, peopleApi, withFallback } from "@/lib/api";

export async function loadPeopleDirectoryReferenceData() {
  const scope = await withFallback(peopleApi.accessScope(), {
    is_global: false,
    org_ids: [],
    class_ids: [],
    classes: [],
  });
  const scopedClasses = scope.is_global
    ? classApi.list({ is_active: "true" })
    : Promise.resolve(scope.classes ?? []);
  const scopedOrgs = scope.is_global
    ? orgsApi.list({ active_only: true })
    : Promise.all((scope.org_ids ?? []).map((orgId) => orgsApi.get(orgId)));
  const scopedPositions = scope.is_global
    ? adminApi.listPositions()
    : Promise.all((scope.org_ids ?? []).map((orgId) => orgsApi.listPositions(orgId))).then((rows) =>
        rows.flat(),
      );
  const [classes, orgs, positions, users] = await Promise.all([
    withFallback(scopedClasses, []),
    withFallback(scopedOrgs, []),
    withFallback(scopedPositions, []),
    scope.is_global ? withFallback(adminApi.listUsers({ limit: 200 }), []) : Promise.resolve([]),
  ]);
  const allowedOrgIds = new Set(scope.org_ids ?? []);
  const orgNames = new Map(orgs.map((item) => [item.id, item.name]));

  return {
    classes,
    orgs,
    positions: positions
      .filter((item) => scope.is_global || allowedOrgIds.has(item.org_id))
      .map((item) => ({
        ...item,
        org_name:
          "org_name" in item && typeof item.org_name === "string"
            ? item.org_name
            : (orgNames.get(item.org_id) ?? ""),
      })),
    users: scope.is_global ? users : [],
  };
}
