"""Initial application schema

Revision ID: 20251105_initial
Revises: 
Create Date: 2025-11-05 00:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

from app.core.types import GUID

# revision identifiers, used by Alembic.
revision = "20251105_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    user_role_enum = sa.Enum("admin", "user", name="userroleenum")
    access_type_enum = sa.Enum("gui", "cli", "both", name="accesstype")
    inventory_endpoint_type_enum = sa.Enum("esxi", "vcenter", name="inventoryendpointtype")
    inventory_endpoint_status_enum = sa.Enum("never", "ok", "error", name="inventoryendpointstatus")
    inventory_host_state_enum = sa.Enum(
        "connected", "disconnected", "maintenance", name="inventoryhostconnectionstate"
    )
    inventory_power_state_enum = sa.Enum(
        "powered_on", "powered_off", "suspended", "unknown", name="inventorypowerstate"
    )
    telco_fabric_type_enum = sa.Enum("aci", "nxos", name="telcofabrictype")
    telco_status_enum = sa.Enum("pending", "validating", "ready", "failed", name="telcoonboardingstatus")
    aci_node_role_enum = sa.Enum("leaf", "spine", "controller", "unspecified", name="acinoderole")

    op.create_table(
        "users",
        sa.Column("id", GUID(), nullable=False),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("full_name", sa.String(), nullable=False),
        sa.Column("hashed_password", sa.String(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("role", user_role_enum, nullable=False, server_default="user"),
        sa.Column("totp_secret", sa.LargeBinary(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_users_email"), "users", ["email"], unique=True)

    op.create_table(
        "groups",
        sa.Column("id", GUID(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.String(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )

    op.create_table(
        "systems",
        sa.Column("id", GUID(), nullable=False),
        sa.Column("group_id", GUID(), sa.ForeignKey("groups.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("ip_address", sa.String(), nullable=False),
        sa.Column("url", sa.String(), nullable=True),
        sa.Column("username", sa.String(), nullable=False, server_default=""),
        sa.Column("access_type", access_type_enum, nullable=False, server_default="gui"),
        sa.Column("credential_secret", sa.LargeBinary(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "system_credentials",
        sa.Column("id", GUID(), nullable=False),
        sa.Column("system_id", GUID(), sa.ForeignKey("systems.id", ondelete="CASCADE"), nullable=False),
        sa.Column("label", sa.String(), nullable=False),
        sa.Column("login_endpoint", sa.String(), nullable=False),
        sa.Column("access_scope", access_type_enum.copy(), nullable=False),
        sa.Column("credential_secret", sa.LargeBinary(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "inventory_endpoints",
        sa.Column("id", GUID(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("address", sa.String(), nullable=False),
        sa.Column("port", sa.Integer(), nullable=False, server_default="443"),
        sa.Column("source_type", inventory_endpoint_type_enum, nullable=False, server_default="esxi"),
        sa.Column("username", sa.String(), nullable=False),
        sa.Column("password_secret", sa.LargeBinary(), nullable=False),
        sa.Column("verify_ssl", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("poll_interval_seconds", sa.Integer(), nullable=False, server_default="300"),
        sa.Column("tags", sa.JSON(), nullable=False),
        sa.Column("last_polled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_poll_status", inventory_endpoint_status_enum, nullable=False, server_default="never"),
        sa.Column("last_error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "inventory_hosts",
        sa.Column("id", GUID(), nullable=False),
        sa.Column(
            "endpoint_id",
            GUID(),
            sa.ForeignKey("inventory_endpoints.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("cluster", sa.String(), nullable=True),
        sa.Column("hardware_model", sa.String(), nullable=True),
        sa.Column(
            "connection_state",
            inventory_host_state_enum,
            nullable=False,
            server_default="connected",
        ),
        sa.Column(
            "power_state",
            inventory_power_state_enum,
            nullable=False,
            server_default="powered_on",
        ),
        sa.Column("cpu_cores", sa.Integer(), nullable=True),
        sa.Column("cpu_usage_mhz", sa.Integer(), nullable=True),
        sa.Column("memory_total_mb", sa.Integer(), nullable=True),
        sa.Column("memory_usage_mb", sa.Integer(), nullable=True),
        sa.Column("uptime_seconds", sa.Integer(), nullable=True),
        sa.Column("datastore_total_gb", sa.Float(), nullable=True),
        sa.Column("datastore_free_gb", sa.Float(), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("endpoint_id", "name", name="uq_inventory_host_endpoint_name"),
    )
    op.create_index(
        op.f("ix_inventory_hosts_endpoint_id"),
        "inventory_hosts",
        ["endpoint_id"],
        unique=False,
    )

    op.create_table(
        "inventory_virtual_machines",
        sa.Column("id", GUID(), nullable=False),
        sa.Column(
            "endpoint_id",
            GUID(),
            sa.ForeignKey("inventory_endpoints.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "host_id",
            GUID(),
            sa.ForeignKey("inventory_hosts.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("guest_os", sa.String(), nullable=True),
        sa.Column(
            "power_state",
            inventory_power_state_enum.copy(),
            nullable=False,
            server_default="powered_off",
        ),
        sa.Column("cpu_count", sa.Integer(), nullable=True),
        sa.Column("memory_mb", sa.Integer(), nullable=True),
        sa.Column("cpu_usage_mhz", sa.Integer(), nullable=True),
        sa.Column("memory_usage_mb", sa.Integer(), nullable=True),
        sa.Column("provisioned_storage_gb", sa.Float(), nullable=True),
        sa.Column("used_storage_gb", sa.Float(), nullable=True),
        sa.Column("ip_address", sa.String(), nullable=True),
        sa.Column("datastores", sa.JSON(), nullable=False),
        sa.Column("networks", sa.JSON(), nullable=False),
        sa.Column("tools_status", sa.String(), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("endpoint_id", "name", name="uq_inventory_vm_endpoint_name"),
    )
    op.create_index(
        op.f("ix_inventory_virtual_machines_endpoint_id"),
        "inventory_virtual_machines",
        ["endpoint_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_inventory_virtual_machines_host_id"),
        "inventory_virtual_machines",
        ["host_id"],
        unique=False,
    )

    op.create_table(
        "inventory_datastores",
        sa.Column("id", GUID(), nullable=False),
        sa.Column(
            "endpoint_id",
            GUID(),
            sa.ForeignKey("inventory_endpoints.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("type", sa.String(), nullable=True),
        sa.Column("capacity_gb", sa.Float(), nullable=True),
        sa.Column("free_gb", sa.Float(), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("endpoint_id", "name", name="uq_inventory_datastore_endpoint_name"),
    )
    op.create_index(
        op.f("ix_inventory_datastores_endpoint_id"),
        "inventory_datastores",
        ["endpoint_id"],
        unique=False,
    )

    op.create_table(
        "inventory_networks",
        sa.Column("id", GUID(), nullable=False),
        sa.Column(
            "endpoint_id",
            GUID(),
            sa.ForeignKey("inventory_endpoints.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("endpoint_id", "name", name="uq_inventory_network_endpoint_name"),
    )
    op.create_index(
        op.f("ix_inventory_networks_endpoint_id"),
        "inventory_networks",
        ["endpoint_id"],
        unique=False,
    )

    op.create_table(
        "telco_fabric_onboarding_jobs",
        sa.Column("id", GUID(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
    sa.Column("fabric_type", telco_fabric_type_enum, nullable=False),
        sa.Column("target_host", sa.String(), nullable=False),
        sa.Column("port", sa.Integer(), nullable=False, server_default="443"),
        sa.Column("username", sa.String(), nullable=True),
        sa.Column("password_secret", sa.LargeBinary(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", telco_status_enum, nullable=False, server_default="pending"),
        sa.Column("connection_params", sa.JSON(), nullable=False),
        sa.Column("verify_ssl", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("poll_interval_seconds", sa.Integer(), nullable=False, server_default="900"),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("last_snapshot", sa.JSON(), nullable=True),
        sa.Column("last_polled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_validation_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_validation_completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "aci_fabric_nodes",
        sa.Column("id", GUID(), nullable=False),
        sa.Column("distinguished_name", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("role", aci_node_role_enum, nullable=False, server_default="unspecified"),
        sa.Column("node_id", sa.String(), nullable=False),
        sa.Column("address", sa.String(), nullable=True),
        sa.Column("serial", sa.String(), nullable=True),
        sa.Column("model", sa.String(), nullable=True),
        sa.Column("version", sa.String(), nullable=True),
        sa.Column("vendor", sa.String(), nullable=True),
        sa.Column("node_type", sa.String(), nullable=True),
        sa.Column("apic_type", sa.String(), nullable=True),
        sa.Column("fabric_state", sa.String(), nullable=True),
        sa.Column("admin_state", sa.String(), nullable=True),
        sa.Column("delayed_heartbeat", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("pod", sa.String(), nullable=True),
        sa.Column("site_name", sa.String(), nullable=True),
        sa.Column("rack_location", sa.String(), nullable=True),
        sa.Column(
            "fabric_job_id",
            GUID(),
            sa.ForeignKey("telco_fabric_onboarding_jobs.id"),
            nullable=True,
        ),
        sa.Column("raw_attributes", sa.JSON(), nullable=False),
        sa.Column("last_state_change_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_modified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("fabric_job_id", "distinguished_name", name="uq_aci_fabric_node_job_dn"),
    )

    op.create_table(
        "aci_fabric_node_details",
        sa.Column("id", GUID(), nullable=False),
        sa.Column(
            "node_id",
            GUID(),
            sa.ForeignKey("aci_fabric_nodes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "fabric_job_id",
            GUID(),
            sa.ForeignKey("telco_fabric_onboarding_jobs.id"),
            nullable=True,
        ),
        sa.Column("general", sa.JSON(), nullable=False),
        sa.Column("health", sa.JSON(), nullable=False),
        sa.Column("resources", sa.JSON(), nullable=False),
        sa.Column("environment", sa.JSON(), nullable=False),
        sa.Column("firmware", sa.JSON(), nullable=False),
        sa.Column("port_channels", sa.JSON(), nullable=False),
        sa.Column("connected_endpoints", sa.JSON(), nullable=False),
        sa.Column("collected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("node_id"),
    )

    op.create_table(
        "aci_fabric_node_interfaces",
        sa.Column("id", GUID(), nullable=False),
        sa.Column(
            "node_id",
            GUID(),
            sa.ForeignKey("aci_fabric_nodes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "fabric_job_id",
            GUID(),
            sa.ForeignKey("telco_fabric_onboarding_jobs.id"),
            nullable=True,
        ),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("distinguished_name", sa.String(), nullable=False),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("admin_state", sa.String(), nullable=True),
        sa.Column("oper_state", sa.String(), nullable=True),
        sa.Column("oper_speed", sa.String(), nullable=True),
        sa.Column("usage", sa.String(), nullable=True),
        sa.Column("last_link_change_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("mtu", sa.Integer(), nullable=True),
        sa.Column("fec_mode", sa.String(), nullable=True),
        sa.Column("duplex", sa.String(), nullable=True),
        sa.Column("mac", sa.String(), nullable=True),
        sa.Column("port_type", sa.String(), nullable=True),
        sa.Column("bundle_id", sa.String(), nullable=True),
        sa.Column("port_channel_id", sa.String(), nullable=True),
        sa.Column("port_channel_name", sa.String(), nullable=True),
        sa.Column("vlan_list", sa.String(), nullable=True),
        sa.Column("attributes", sa.JSON(), nullable=False),
        sa.Column("transceiver", sa.JSON(), nullable=False),
        sa.Column("stats", sa.JSON(), nullable=False),
        sa.Column("epg_bindings", sa.JSON(), nullable=False),
        sa.Column("l3out_bindings", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("node_id", "name", name="uq_aci_node_interface"),
    )
    op.create_index(
        op.f("ix_aci_fabric_node_interfaces_node_id"),
        "aci_fabric_node_interfaces",
        ["node_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_aci_fabric_node_interfaces_node_id"), table_name="aci_fabric_node_interfaces")
    op.drop_table("aci_fabric_node_interfaces")
    op.drop_table("aci_fabric_node_details")
    op.drop_table("aci_fabric_nodes")
    op.drop_table("telco_fabric_onboarding_jobs")
    op.drop_index(op.f("ix_inventory_networks_endpoint_id"), table_name="inventory_networks")
    op.drop_table("inventory_networks")
    op.drop_index(op.f("ix_inventory_datastores_endpoint_id"), table_name="inventory_datastores")
    op.drop_table("inventory_datastores")
    op.drop_index(op.f("ix_inventory_virtual_machines_host_id"), table_name="inventory_virtual_machines")
    op.drop_index(op.f("ix_inventory_virtual_machines_endpoint_id"), table_name="inventory_virtual_machines")
    op.drop_table("inventory_virtual_machines")
    op.drop_index(op.f("ix_inventory_hosts_endpoint_id"), table_name="inventory_hosts")
    op.drop_table("inventory_hosts")
    op.drop_table("inventory_endpoints")
    op.drop_table("system_credentials")
    op.drop_table("systems")
    op.drop_table("groups")
    op.drop_index(op.f("ix_users_email"), table_name="users")
    op.drop_table("users")

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        enums = [
            "acinoderole",
            "accesstype",
            "inventoryendpointstatus",
            "inventoryendpointtype",
            "inventoryhostconnectionstate",
            "inventorypowerstate",
            "telcofabrictype",
            "telcoonboardingstatus",
            "userroleenum",
        ]
        for enum_name in enums:
            op.execute(sa.text(f"DROP TYPE IF EXISTS {enum_name}"))
