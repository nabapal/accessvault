"""add is_template to inventory_virtual_machines

Revision ID: 20260724_add_vm_is_template
Revises: 20260723_add_cpnr_inventory
Create Date: 2026-07-24
"""
from alembic import op
import sqlalchemy as sa

revision = "20260724_add_vm_is_template"
down_revision = "20260723_add_cpnr_inventory"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "inventory_virtual_machines",
        sa.Column("is_template", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("inventory_virtual_machines", "is_template")
