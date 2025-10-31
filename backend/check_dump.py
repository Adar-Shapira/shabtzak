#!/usr/bin/env python3
"""Check olddata.dump file format and search for Hebrew content."""
import sys
import os

dump_file = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'olddata.dump')

if not os.path.exists(dump_file):
    print(f"File not found: {dump_file}")
    sys.exit(1)

print(f"Checking: {dump_file}")
print(f"Size: {os.path.getsize(dump_file)} bytes")

# Try to read as text first
try:
    with open(dump_file, 'r', encoding='utf-8') as f:
        content = f.read(10000)  # Read first 10KB
        if 'PostgreSQL database dump' in content or 'pg_dump' in content:
            print("Format: PostgreSQL text dump")
            # Check for Hebrew
            if any('\u0590' <= c <= '\u05FF' for c in content):
                print("✓ Contains Hebrew characters!")
            else:
                print("No Hebrew characters in first 10KB")
        else:
            print("Format: Unknown text format")
            print(f"First 200 chars: {repr(content[:200])}")
except UnicodeDecodeError:
    # Try as binary
    print("Format: Binary file (likely PostgreSQL binary dump)")
    with open(dump_file, 'rb') as f:
        header = f.read(100)
        if header.startswith(b'PGDMP'):
            print("Confirmed: PostgreSQL binary dump (pg_dump -Fc)")
            print("This requires pg_restore to extract data")
        else:
            print(f"Binary file, first 100 bytes: {header[:100]}")

