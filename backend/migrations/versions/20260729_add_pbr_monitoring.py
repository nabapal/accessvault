"""add PBR flow monitoring (services + nodes + redirect dests + subnets + health samples)

Revision ID: 20260729_add_pbr_monitoring
Revises: 20260723_add_cpnr_inventory
Create Date: 2026-07-29

Enum columns are stored as VARCHAR holding the SQLAlchemy Enum *member name*
(matching the existing convention, e.g. aci_fabric_nodes.role stores 'LEAF'), so
server_default values here are member names (e.g. 'UNKNOWN'), not lowercase values.
"""
from alembic import op
import sqlalchemy as sa

from app.core.types import GUID

revision = "20260729_add_pbr_monitoring"
down_revision = "20260723_add_cpnr_inventory"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "pbr_services",
        sa.Column("id", GUID(), primary_key=True),
        sa.Column(
            "fabric_job_id",
            GUID(),
            sa.ForeignKey("telco_fabric_onboarding_jobs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("contract_dn", sa.String(), nullable=False),
        sa.Column("graph_dn", sa.String(), nullable=False),
        sa.Column("contract_name", sa.String(), nullable=True),
        sa.Column("graph_name", sa.String(), nullable=True),
        sa.Column("consumer_epg_dn", sa.String(), nullable=True),
        sa.Column("provider_epg_dn", sa.String(), nullable=True),
        sa.Column("consumer_epg_name", sa.String(), nullable=True),
        sa.Column("provider_epg_name", sa.String(), nullable=True),
        sa.Column("health_pct", sa.Float(), nullable=True),
        sa.Column("state", sa.String(), nullable=False, server_default="UNKNOWN"),
        sa.Column("stale_as_of", sa.DateTime(timezone=True), nullable=True),
        sa.Column("raw_attributes", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("fabric_job_id", "contract_dn", "graph_dn", name="uq_pbr_service_job_contract_graph"),
    )
    op.create_index("ix_pbr_services_fabric_job_id", "pbr_services", ["fabric_job_id"])

    op.create_table(
        "pbr_nodes",
        sa.Column("id", GUID(), primary_key=True),
        sa.Column(
            "fabric_job_id",
            GUID(),
            sa.ForeignKey("telco_fabric_onboarding_jobs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("service_id", GUID(), sa.ForeignKey("pbr_services.id", ondelete="CASCADE"), nullable=False),
        sa.Column("distinguished_name", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=True),
        sa.Column("function_type", sa.String(), nullable=True),
        sa.Column("layer", sa.String(), nullable=False, server_default="UNKNOWN"),
        sa.Column("device_group_dn", sa.String(), nullable=True),
        sa.Column("device_group_name", sa.String(), nullable=True),
        sa.Column("leaf", sa.String(), nullable=True),
        sa.Column("path", sa.String(), nullable=True),
        sa.Column("consumer_bd", sa.String(), nullable=True),
        sa.Column("consumer_vrf", sa.String(), nullable=True),
        sa.Column("consumer_vlan", sa.String(), nullable=True),
        sa.Column("provider_bd", sa.String(), nullable=True),
        sa.Column("provider_vrf", sa.String(), nullable=True),
        sa.Column("provider_vlan", sa.String(), nullable=True),
        sa.Column("redirect_policy_names", sa.JSON(), nullable=False),
        sa.Column("threshold_enable", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("min_threshold_pct", sa.Float(), nullable=True),
        sa.Column("max_threshold_pct", sa.Float(), nullable=True),
        sa.Column("threshold_down_action", sa.String(), nullable=False, server_default="UNKNOWN"),
        sa.Column("configured_dest_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("learned_dest_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("health_pct", sa.Float(), nullable=True),
        sa.Column("live_status", sa.String(), nullable=False, server_default="UNKNOWN"),
        sa.Column("bypassed", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("raw_attributes", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("service_id", "distinguished_name", name="uq_pbr_node_service_dn"),
    )
    op.create_index("ix_pbr_nodes_fabric_job_id", "pbr_nodes", ["fabric_job_id"])
    op.create_index("ix_pbr_nodes_service_id", "pbr_nodes", ["service_id"])
    op.create_index("ix_pbr_nodes_device_group_dn", "pbr_nodes", ["device_group_dn"])

    op.create_table(
        "pbr_redirect_dests",
        sa.Column("id", GUID(), primary_key=True),
        sa.Column("node_id", GUID(), sa.ForeignKey("pbr_nodes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("ip", sa.String(), nullable=True),
        sa.Column("mac", sa.String(), nullable=True),
        sa.Column("layer", sa.String(), nullable=False, server_default="UNKNOWN"),
        sa.Column("l1_interface_ref", sa.String(), nullable=True),
        sa.Column("resolved", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("learned", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("raw_attributes", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_pbr_redirect_dests_node_id", "pbr_redirect_dests", ["node_id"])

    op.create_table(
        "pbr_subnets",
        sa.Column("id", GUID(), primary_key=True),
        sa.Column(
            "fabric_job_id",
            GUID(),
            sa.ForeignKey("telco_fabric_onboarding_jobs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("service_id", GUID(), sa.ForeignKey("pbr_services.id", ondelete="CASCADE"), nullable=True),
        sa.Column("epg_dn", sa.String(), nullable=True),
        sa.Column("side", sa.String(), nullable=True),
        sa.Column("prefix", sa.String(), nullable=False),
        sa.Column("scope", sa.String(), nullable=True),
        sa.Column("scope_valid", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("is_default_route", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("raw_attributes", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_pbr_subnets_fabric_job_id", "pbr_subnets", ["fabric_job_id"])
    op.create_index("ix_pbr_subnets_service_id", "pbr_subnets", ["service_id"])

    op.create_table(
        "pbr_health_samples",
        sa.Column("id", GUID(), primary_key=True),
        sa.Column("service_id", GUID(), sa.ForeignKey("pbr_services.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sampled_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("health_pct", sa.Float(), nullable=True),
        sa.Column("state", sa.String(), nullable=False, server_default="UNKNOWN"),
        sa.Column("node_snapshot", sa.JSON(), nullable=True),
    )
    op.create_index("ix_pbr_health_samples_service_id", "pbr_health_samples", ["service_id"])
    op.create_index("ix_pbr_health_samples_sampled_at", "pbr_health_samples", ["sampled_at"])


def downgrade() -> None:
    op.drop_index("ix_pbr_health_samples_sampled_at", table_name="pbr_health_samples")
    op.drop_index("ix_pbr_health_samples_service_id", table_name="pbr_health_samples")
    op.drop_table("pbr_health_samples")
    op.drop_index("ix_pbr_subnets_service_id", table_name="pbr_subnets")
    op.drop_index("ix_pbr_subnets_fabric_job_id", table_name="pbr_subnets")
    op.drop_table("pbr_subnets")
    op.drop_index("ix_pbr_redirect_dests_node_id", table_name="pbr_redirect_dests")
    op.drop_table("pbr_redirect_dests")
    op.drop_index("ix_pbr_nodes_device_group_dn", table_name="pbr_nodes")
    op.drop_index("ix_pbr_nodes_service_id", table_name="pbr_nodes")
    op.drop_index("ix_pbr_nodes_fabric_job_id", table_name="pbr_nodes")
    op.drop_table("pbr_nodes")
    op.drop_index("ix_pbr_services_fabric_job_id", table_name="pbr_services")
    op.drop_table("pbr_services")
