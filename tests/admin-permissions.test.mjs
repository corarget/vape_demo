import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MANAGER_PERMISSIONS, hasPermission, normalizePermissions, permissionForAdminRoute } from "../lib/auth.mjs";

test("every admin surface has an explicit permission policy",()=>{
  const routes=[
    "/api/admin/dashboard","/api/admin/orders","/api/admin/orders/order-1",
    "/api/admin/schedule-settings","/api/admin/slot-blocks","/api/admin/slot-blocks/slot-1",
    "/api/admin/couriers","/api/admin/staff","/api/admin/staff/staff-1","/api/admin/invites",
    "/api/admin/analytics","/api/admin/categories","/api/admin/branding","/api/admin/appearance",
    "/api/admin/settings","/api/admin/promotions","/api/admin/promocodes","/api/admin/config/export",
    "/api/admin/config/import","/api/admin/catalog/products","/api/admin/catalog-preview",
    "/api/admin/catalog-template","/api/admin/catalog-template/file","/api/admin/sync-settings",
    "/api/admin/sync","/api/admin/sync-runs","/api/admin/logs","/api/admin/integrations",
    "/api/admin/integrations/webhook"
  ];
  for(const route of routes)assert.notEqual(permissionForAdminRoute(route,"GET"),null,route);
});

test("appearance follows the same read/manage boundary as other branding data",()=>{
  assert.equal(permissionForAdminRoute("/api/admin/appearance","GET"),"branding");
  assert.equal(permissionForAdminRoute("/api/admin/appearance","PUT"),"branding.manage");
  const manager={role:"manager",permissions:DEFAULT_MANAGER_PERMISSIONS};
  assert.equal(hasPermission(manager,"branding"),false);
  assert.equal(hasPermission({role:"manager",permissions:normalizePermissions(["branding.manage"])},"branding"),true);
  assert.equal(hasPermission({role:"owner",permissions:[]},"branding.manage"),true);
});
