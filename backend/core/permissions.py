"""Stable application permissions and role presets.

Roles remain useful labels/presets. Authorization uses the effective permission
set loaded from the current user document on every request.
"""

PERMISSION_GROUPS = [
    {"key": "dashboard", "label": "Dashboard", "permissions": [
        {"key": "dashboard.view", "label": "Visualizar"},
        {"key": "dashboard.metrics", "label": "Ver vendas e desempenho"},
    ]},
    {"key": "orders", "label": "Pedidos", "permissions": [
        {"key": "orders.view", "label": "Visualizar"},
        {"key": "orders.create", "label": "Criar"},
        {"key": "orders.edit", "label": "Editar"},
        {"key": "orders.status", "label": "Alterar status"},
        {"key": "orders.cancel", "label": "Cancelar"},
    ]},
    {"key": "service", "label": "Garçom", "permissions": [
        {"key": "service.view", "label": "Acessar tela operacional"},
    ]},
    {"key": "kds", "label": "Cozinha (KDS)", "permissions": [
        {"key": "kds.view", "label": "Visualizar"},
        {"key": "kds.status", "label": "Alterar status"},
    ]},
    {"key": "customers", "label": "Clientes", "permissions": [
        {"key": "customers.view", "label": "Visualizar"},
        {"key": "customers.manage", "label": "Gerenciar"},
    ]},
    {"key": "products", "label": "Produtos", "permissions": [
        {"key": "products.view", "label": "Visualizar"},
        {"key": "products.manage", "label": "Gerenciar"},
    ]},
    {"key": "history", "label": "Histórico", "permissions": [
        {"key": "history.view", "label": "Visualizar"},
        {"key": "history.export", "label": "Exportar"},
    ]},
    {"key": "whatsapp", "label": "WhatsApp", "permissions": [
        {"key": "whatsapp.view", "label": "Visualizar"},
        {"key": "whatsapp.operate", "label": "Atender e vincular clientes"},
        {"key": "whatsapp.configure", "label": "Configurar conexão e mensagens"},
    ]},
    {"key": "users", "label": "Usuários", "permissions": [
        {"key": "users.view", "label": "Visualizar"},
        {"key": "users.manage", "label": "Gerenciar"},
    ]},
]

ALL_PERMISSIONS = frozenset(
    permission["key"]
    for group in PERMISSION_GROUPS
    for permission in group["permissions"]
)

ROLE_PERMISSION_PRESETS = {
    "admin": ALL_PERMISSIONS,
    "manager": frozenset({
        "dashboard.view", "dashboard.metrics",
        "orders.view", "orders.create", "orders.edit", "orders.status", "orders.cancel",
        "customers.view", "customers.manage",
        "products.view", "products.manage",
        "history.view", "history.export",
        "whatsapp.view", "whatsapp.operate", "whatsapp.configure",
    }),
    "waiter": frozenset({
        "dashboard.view", "service.view",
        "orders.view", "orders.create", "orders.edit", "orders.status", "orders.cancel",
        "customers.view", "customers.manage",
        "products.view",
        "history.view", "history.export",
        "whatsapp.view", "whatsapp.operate",
    }),
    "kitchen": frozenset({
        "dashboard.view", "orders.view", "kds.view", "kds.status", "history.view",
    }),
}


def permissions_for_role(role: str) -> list[str]:
    return sorted(ROLE_PERMISSION_PRESETS.get(role, frozenset()))


def effective_permissions(user: dict) -> list[str]:
    stored = user.get("permissions")
    if stored is None:
        return permissions_for_role(user.get("role", "waiter"))
    return sorted(set(stored) & ALL_PERMISSIONS)


def validate_permissions(permissions: list[str]) -> list[str]:
    unknown = sorted(set(permissions) - ALL_PERMISSIONS)
    if unknown:
        raise ValueError(f"Permissões inválidas: {', '.join(unknown)}")
    return sorted(set(permissions))


def has_permission(user: dict, permission: str) -> bool:
    return permission in effective_permissions(user)
