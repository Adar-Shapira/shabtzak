#!/usr/bin/env python3
"""
Convert PostgreSQL binary dump to SQL file.
This script uses pg_restore if available, otherwise provides instructions.
"""
import os
import sys
import subprocess

dump_file = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'olddata.dump')
output_file = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'olddata_converted.sql')

def check_pg_restore():
    """Check if pg_restore is available."""
    try:
        result = subprocess.run(['pg_restore', '--version'], 
                              capture_output=True, text=True, timeout=5)
        if result.returncode == 0:
            print(f"Found pg_restore: {result.stdout.strip()}")
            return True
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    return False

def convert_dump():
    """Convert binary dump to SQL."""
    if not os.path.exists(dump_file):
        print(f"Error: Dump file not found: {dump_file}")
        sys.exit(1)
    
    if not check_pg_restore():
        print("Error: pg_restore not found.")
        print("\nTo convert the dump file, you need PostgreSQL client tools installed.")
        print("\nOptions:")
        print("1. Install PostgreSQL client tools: https://www.postgresql.org/download/")
        print("2. Or use Docker: docker run --rm -v \"${PWD}:/data\" postgres pg_restore -f /data/olddata_converted.sql /data/olddata.dump")
        print("3. Or access your PostgreSQL database directly and export:")
        print("   pg_dump -h localhost -U your_user -d your_db --data-only --inserts > olddata_hebrew.sql")
        sys.exit(1)
    
    print(f"Converting {dump_file} to {output_file}...")
    
    try:
        # Use pg_restore to convert binary dump to SQL
        # --no-owner --no-privileges for compatibility
        result = subprocess.run([
            'pg_restore',
            '--no-owner',
            '--no-privileges',
            '--format=custom',
            '--file', output_file if output_file.endswith('.sql') else output_file.replace('.dump', '.sql'),
            dump_file
        ], capture_output=True, text=True, timeout=60)
        
        if result.returncode != 0:
            # Try direct SQL output
            print("Trying direct SQL conversion...")
            with open(output_file, 'w', encoding='utf-8') as f:
                result = subprocess.run([
                    'pg_restore',
                    '--no-owner',
                    '--no-privileges',
                    dump_file
                ], stdout=f, stderr=subprocess.PIPE, text=True, timeout=60)
            
            if result.returncode != 0:
                print(f"Error: {result.stderr}")
                sys.exit(1)
        
        print(f"✓ Successfully converted to: {output_file}")
        print(f"File size: {os.path.getsize(output_file)} bytes")
        
        # Check for Hebrew
        with open(output_file, 'r', encoding='utf-8') as f:
            sample = f.read(50000)  # Check first 50KB
            if any('\u0590' <= c <= '\u05FF' for c in sample):
                print("✓ Contains Hebrew characters!")
            else:
                print("⚠ No Hebrew characters found in converted file")
        
    except subprocess.TimeoutExpired:
        print("Error: pg_restore timed out")
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)

if __name__ == '__main__':
    convert_dump()

