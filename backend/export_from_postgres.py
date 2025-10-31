#!/usr/bin/env python3
"""
Export data from PostgreSQL database to SQL file.
This script connects to PostgreSQL and exports all data as INSERT statements.
"""
import os
import sys
import subprocess
import argparse

def check_pg_dump():
    """Check if pg_dump is available."""
    try:
        result = subprocess.run(['pg_dump', '--version'], 
                              capture_output=True, text=True, timeout=5)
        if result.returncode == 0:
            print(f"✓ Found pg_dump: {result.stdout.strip()}")
            return True
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    return False

def export_data(host='localhost', port=5432, user=None, password=None, 
                database=None, output_file='olddata_hebrew.sql'):
    """Export PostgreSQL data to SQL file."""
    
    if not check_pg_dump():
        print("\n❌ Error: pg_dump not found.")
        print("\nPlease install PostgreSQL client tools:")
        print("  Windows: Download from https://www.postgresql.org/download/windows/")
        print("           Or install via Chocolatey: choco install postgresql")
        print("  Or use Docker if you have it installed.")
        sys.exit(1)
    
    # Build connection string
    # Password can be passed via PGPASSWORD environment variable
    if password:
        os.environ['PGPASSWORD'] = password
    
    if not all([host, user, database]):
        print("Error: Missing required connection parameters.")
        print("Required: --host, --user, --database")
        print("Optional: --port (default: 5432), --password")
        sys.exit(1)
    
    print(f"\n📦 Exporting data from PostgreSQL...")
    print(f"   Host: {host}")
    print(f"   Port: {port}")
    print(f"   User: {user}")
    print(f"   Database: {database}")
    print(f"   Output: {output_file}")
    print()
    
    try:
        # Build pg_dump command
        # --data-only: Only export data, not schema
        # --inserts: Use INSERT statements instead of COPY
        # --column-inserts: Include column names (more verbose but clearer)
        cmd = [
            'pg_dump',
            f'--host={host}',
            f'--port={port}',
            f'--username={user}',
            '--data-only',
            '--inserts',
            '--no-owner',
            '--no-privileges',
            database
        ]
        
        print("Running pg_dump...")
        with open(output_file, 'w', encoding='utf-8') as f:
            result = subprocess.run(
                cmd,
                stdout=f,
                stderr=subprocess.PIPE,
                text=True,
                timeout=300  # 5 minute timeout
            )
        
        if result.returncode != 0:
            error_msg = result.stderr
            if 'password' in error_msg.lower() or 'authentication' in error_msg.lower():
                print("❌ Authentication failed.")
                print("   Try setting PGPASSWORD environment variable or use .pgpass file")
            else:
                print(f"❌ Error: {error_msg}")
            sys.exit(1)
        
        file_size = os.path.getsize(output_file)
        print(f"✓ Successfully exported to: {output_file}")
        print(f"  File size: {file_size:,} bytes ({file_size/1024:.1f} KB)")
        
        # Check for Hebrew content
        with open(output_file, 'r', encoding='utf-8') as f:
            sample = f.read(100000)  # Check first 100KB
            hebrew_chars = [c for c in sample if '\u0590' <= c <= '\u05FF']
            if hebrew_chars:
                print(f"✓ Found Hebrew characters! ({len(hebrew_chars)} Hebrew chars in sample)")
                # Show some examples
                hebrew_lines = [line for line in sample.split('\n') 
                               if any('\u0590' <= c <= '\u05FF' for c in line)]
                if hebrew_lines:
                    print("  Sample line with Hebrew:")
                    print(f"  {hebrew_lines[0][:100]}...")
            else:
                print("⚠ No Hebrew characters found in exported file")
        
        return output_file
        
    except subprocess.TimeoutExpired:
        print("❌ Error: pg_dump timed out (export took longer than 5 minutes)")
        sys.exit(1)
    except Exception as e:
        print(f"❌ Error: {e}")
        sys.exit(1)
    finally:
        # Clean up environment variable
        if 'PGPASSWORD' in os.environ:
            del os.environ['PGPASSWORD']

def main():
    parser = argparse.ArgumentParser(
        description='Export PostgreSQL data to SQL file',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Using environment variables
  $env:PGPASSWORD="your_password"
  python export_from_postgres.py --host localhost --user shabtzak --database shabtzak
  
  # With all parameters
  python export_from_postgres.py --host localhost --port 5432 --user shabtzak --password mypass --database shabtzak
  
  # Using Docker PostgreSQL
  python export_from_postgres.py --host localhost --user postgres --database shabtzak
        """
    )
    
    parser.add_argument('--host', default='localhost', help='PostgreSQL host (default: localhost)')
    parser.add_argument('--port', type=int, default=5432, help='PostgreSQL port (default: 5432)')
    parser.add_argument('--user', required=True, help='PostgreSQL username')
    parser.add_argument('--password', help='PostgreSQL password (or set PGPASSWORD env var)')
    parser.add_argument('--database', required=True, help='PostgreSQL database name')
    parser.add_argument('--output', default='olddata_hebrew.sql', 
                       help='Output SQL file (default: olddata_hebrew.sql)')
    
    args = parser.parse_args()
    
    export_data(
        host=args.host,
        port=args.port,
        user=args.user,
        password=args.password,
        database=args.database,
        output_file=args.output
    )

if __name__ == '__main__':
    main()

