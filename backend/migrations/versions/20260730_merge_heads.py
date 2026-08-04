"""merge vm-template and pbr migration heads

Two independent branches (VM template inventory and PBR monitoring) were merged
into the repo concurrently, producing two Alembic heads. This no-op merge unifies
them so `alembic upgrade head` resolves to a single head again.

Revision ID: 20260730_merge_heads
Revises: 20260724_add_vm_is_template, 20260729_pbr_detail_columns
Create Date: 2026-07-30
"""
from alembic import op  # noqa: F401
import sqlalchemy as sa  # noqa: F401

revision = "20260730_merge_heads"
down_revision = ("20260724_add_vm_is_template", "20260729_pbr_detail_columns")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
