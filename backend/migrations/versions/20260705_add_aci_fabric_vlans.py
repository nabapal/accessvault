"""Add aci_fabric_vlans table for per-fabric deployed VLAN inventory

Revision ID: 20260705_add_aci_fabric_vlans
Revises: 20260705_add_interface_oper_st_qual
Create Date: 2026-07-05 02:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

from app.core.types import GUID


revision = "20260705_add_aci_fabric_vlans"
down_revision = "20260705_add_interface_oper_st_qual"
branch_labels: tuple[str, ...] | None = None
depends_on: tuple[str, ...] | None = None


TABLE_NAME = "aci_fabric_vlans"


def upgrade() -> None:
    op.create_table(
        TABLE_NAME,
        sa.Column("id", GUID(), nullable=False),
        sa.Column(
            "fabric_job_id",
            GUID(),
            sa.ForeignKey("telco_fabric_onboarding_jobs.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("vlan_id", sa.Integer(), nullable=True),
        sa.Column("encap", sa.String(), nullable=False),
        sa.Column("fab_encap", sa.String(), nullable=True),
        sa.Column("epg", sa.String(), nullable=True),
        sa.Column("tenant", sa.String(), nullable=True),
        sa.Column("app_profile", sa.String(), nullable=True),
        sa.Column("bridge_domain", sa.String(), nullable=True),
        sa.Column("vrf", sa.String(), nullable=True),
        sa.Column("pc_tag", sa.String(), nullable=True),
        sa.Column("mode", sa.String(), nullable=True),
        sa.Column("admin_state", sa.String(), nullable=True),
        sa.Column("oper_state", sa.String(), nullable=True),
        sa.Column("node_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("nodes", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("fabric_job_id", "encap", name="uq_aci_fabric_vlan"),
    )
    op.create_index(op.f("ix_aci_fabric_vlans_fabric_job_id"), TABLE_NAME, ["fabric_job_id"], unique=False)
    op.create_index(op.f("ix_aci_fabric_vlans_vlan_id"), TABLE_NAME, ["vlan_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_aci_fabric_vlans_vlan_id"), table_name=TABLE_NAME)
    op.drop_index(op.f("ix_aci_fabric_vlans_fabric_job_id"), table_name=TABLE_NAME)
    op.drop_table(TABLE_NAME)
