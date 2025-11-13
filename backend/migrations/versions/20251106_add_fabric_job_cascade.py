"""Cascade delete ACI fabric nodes when fabric job is removed

Revision ID: 20251106_add_fabric_job_cascade
Revises: 20251105_initial
Create Date: 2025-11-06 00:00:00
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

FK_NAME = "fk_aci_fabric_nodes_fabric_job_id"

# revision identifiers, used by Alembic.
revision = "20251106_add_fabric_job_cascade"
down_revision = "20251105_initial"
branch_labels = None
depends_on = None


def _current_fk_name() -> str | None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    for fk in inspector.get_foreign_keys("aci_fabric_nodes"):
        if fk.get("referred_table") == "telco_fabric_onboarding_jobs" and fk.get("constrained_columns") == [
            "fabric_job_id"
        ]:
            return fk.get("name")
    return None


def upgrade() -> None:
    existing_fk = _current_fk_name()
    with op.batch_alter_table("aci_fabric_nodes", schema=None) as batch_op:
        if existing_fk:
            batch_op.drop_constraint(existing_fk, type_="foreignkey")
        batch_op.create_foreign_key(
            FK_NAME,
            "telco_fabric_onboarding_jobs",
            ["fabric_job_id"],
            ["id"],
            ondelete="CASCADE",
        )


def downgrade() -> None:
    existing_fk = _current_fk_name()
    with op.batch_alter_table("aci_fabric_nodes", schema=None) as batch_op:
        if existing_fk:
            batch_op.drop_constraint(existing_fk, type_="foreignkey")
        batch_op.create_foreign_key(
            FK_NAME,
            "telco_fabric_onboarding_jobs",
            ["fabric_job_id"],
            ["id"],
        )
