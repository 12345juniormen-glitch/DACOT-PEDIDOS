const LEGACY_ROLE_PRESETS = {
  admin: [
    "dashboard.view", "dashboard.metrics", "orders.view", "orders.create", "orders.edit", "orders.status", "orders.cancel",
    "kds.view", "kds.status", "customers.view", "customers.manage", "products.view", "products.manage",
    "history.view", "history.export", "whatsapp.view", "whatsapp.operate", "whatsapp.configure",
    "users.view", "users.manage",
  ],
  manager: [
    "dashboard.view", "dashboard.metrics", "orders.view", "orders.create", "orders.edit", "orders.status", "orders.cancel",
    "customers.view", "customers.manage", "products.view", "products.manage", "history.view", "history.export",
    "whatsapp.view", "whatsapp.operate", "whatsapp.configure",
  ],
  waiter: [
    "dashboard.view", "orders.view", "orders.create", "orders.edit", "orders.status", "orders.cancel",
    "customers.view", "customers.manage", "products.view", "history.view", "history.export",
    "whatsapp.view", "whatsapp.operate",
  ],
  kitchen: ["dashboard.view", "orders.view", "kds.view", "kds.status", "history.view"],
};

export function effectivePermissions(user) {
  if (Array.isArray(user?.permissions)) return user.permissions;
  return LEGACY_ROLE_PRESETS[user?.role] || [];
}

export function hasPermission(user, permission) {
  return effectivePermissions(user).includes(permission);
}

export function hasAnyPermission(user, permissions) {
  const effective = new Set(effectivePermissions(user));
  return permissions.some((permission) => effective.has(permission));
}
