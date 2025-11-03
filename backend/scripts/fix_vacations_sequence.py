#!/usr/bin/env python3
"""Fix the vacations.id sequence to match the max id in the table.

This script resets the PostgreSQL sequence for vacations.id to be one greater
than the maximum existing ID. This fixes the issue where the sequence gets
out of sync after manual data imports or other operations.

Run this from the backend directory:
    python scripts/fix_vacations_sequence.py
"""

import os
import sys
from sqlalchemy import create_engine, text

# Add parent directory to path to import app modules
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db import SessionLocal


def fix_sequence():
    """Fix the vacations.id sequence."""
    with SessionLocal() as session:
        # Get the current max ID
        result = session.execute(text("SELECT COALESCE(MAX(id), 0) FROM vacations"))
        max_id = result.scalar()
        
        # Get the sequence name
        result = session.execute(text(
            "SELECT pg_get_serial_sequence('vacations', 'id')"
        ))
        seq_name = result.scalar()
        
        if not seq_name:
            print("ERROR: Could not find sequence for vacations.id")
            return False
        
        # Extract just the sequence name (remove schema prefix if present)
        seq_name = seq_name.split('.')[-1]
        
        # Set the sequence to max_id + 1
        new_value = max_id + 1
        session.execute(text(f"SELECT setval('{seq_name}', :new_val, false)"), {"new_val": new_value})
        session.commit()
        
        print(f"✓ Fixed vacations sequence: set to {new_value} (max_id was {max_id})")
        return True


if __name__ == "__main__":
    try:
        if fix_sequence():
            print("Sequence fixed successfully!")
            sys.exit(0)
        else:
            print("Failed to fix sequence")
            sys.exit(1)
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

