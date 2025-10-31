#!/usr/bin/env python3
"""
Export data from PostgreSQL database to SQL file using Python (psycopg).
This doesn't require pg_dump to be installed.
"""
import os
import sys
from datetime import datetime

try:
    import psycopg
except ImportError:
    print("Error: psycopg not installed. Installing...")
    print("Please run: pip install psycopg[binary]")
    sys.exit(1)

def export_data(host='localhost', port=5432, user='shabtzak', password='devpass', 
                database='shabtzak', output_file='olddata_hebrew.sql'):
    """Export PostgreSQL data to SQL file using Python."""
    
    print(f"\n📦 Exporting data from PostgreSQL...")
    print(f"   Host: {host}")
    print(f"   Port: {port}")
    print(f"   User: {user}")
    print(f"   Database: {database}")
    print(f"   Output: {output_file}")
    print()
    
    try:
        # Connect to PostgreSQL
        conn_str = f"host={host} port={port} user={user} password={password} dbname={database}"
        print("Connecting to PostgreSQL...")
        conn = psycopg.connect(conn_str)
        cursor = conn.cursor()
        
        print("✓ Connected successfully!")
        
        # Get all tables (excluding system tables)
        cursor.execute("""
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_type = 'BASE TABLE'
            ORDER BY table_name
        """)
        tables = [row[0] for row in cursor.fetchall()]
        print(f"Found {len(tables)} tables: {', '.join(tables)}")
        print()
        
        # Open output file
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write("--\n")
            f.write(f"-- PostgreSQL database export\n")
            f.write(f"-- Exported on: {datetime.now().isoformat()}\n")
            f.write(f"-- Database: {database}\n")
            f.write("--\n\n")
            
            total_rows = 0
            
            for table in tables:
                print(f"Exporting {table}...", end=' ', flush=True)
                
                # Get column names and types
                cursor.execute(f"""
                    SELECT column_name, data_type 
                    FROM information_schema.columns 
                    WHERE table_schema = 'public' 
                    AND table_name = %s
                    ORDER BY ordinal_position
                """, (table,))
                columns = cursor.fetchall()
                col_names = [col[0] for col in columns]
                
                if not col_names:
                    print("(no columns)")
                    continue
                
                # Fetch all data
                cursor.execute(f'SELECT * FROM "{table}"')
                rows = cursor.fetchall()
                
                if not rows:
                    print("(empty)")
                    continue
                
                # Write INSERT statements
                f.write(f"\n--\n-- Data for Name: {table}\n--\n\n")
                
                for row in rows:
                    # Format values
                    values = []
                    for i, val in enumerate(row):
                        col_type = columns[i][1]
                        if val is None:
                            values.append('NULL')
                        elif col_type in ('timestamp without time zone', 'timestamp with time zone', 'date', 'time'):
                            # Format dates/times as strings
                            if isinstance(val, datetime):
                                values.append(f"'{val.isoformat().replace('T', ' ')}'")
                            elif isinstance(val, str):
                                values.append(f"'{val}'")
                            else:
                                values.append(f"'{str(val)}'")
                        elif isinstance(val, str):
                            # Escape single quotes in strings
                            escaped = val.replace("'", "''")
                            values.append(f"'{escaped}'")
                        elif isinstance(val, (int, float)):
                            values.append(str(val))
                        elif isinstance(val, bool):
                            values.append('TRUE' if val else 'FALSE')
                        else:
                            # Default: convert to string and quote
                            escaped = str(val).replace("'", "''")
                            values.append(f"'{escaped}'")
                    
                    cols_str = ', '.join(col_names)
                    vals_str = ', '.join(values)
                    f.write(f'INSERT INTO {table} ({cols_str}) VALUES ({vals_str});\n')
                
                row_count = len(rows)
                total_rows += row_count
                print(f"✓ {row_count} rows")
            
            f.write(f"\n--\n-- Export complete: {total_rows} total rows\n--\n")
        
        conn.close()
        
        file_size = os.path.getsize(output_file)
        print(f"\n✓ Export complete!")
        print(f"  File: {output_file}")
        print(f"  Size: {file_size:,} bytes ({file_size/1024:.1f} KB)")
        print(f"  Total rows: {total_rows}")
        
        # Check for Hebrew content
        with open(output_file, 'r', encoding='utf-8') as f:
            sample = f.read(100000)  # Check first 100KB
            hebrew_chars = [c for c in sample if '\u0590' <= c <= '\u05FF']
            if hebrew_chars:
                print(f"  ✓ Found Hebrew characters! ({len(hebrew_chars)} Hebrew chars in sample)")
                # Show some examples
                hebrew_lines = [line for line in sample.split('\n') 
                               if any('\u0590' <= c <= '\u05FF' for c in line)]
                if hebrew_lines:
                    print(f"  Sample: {hebrew_lines[0][:80]}...")
            else:
                print("  ⚠ No Hebrew characters found in exported file")
        
        return output_file
        
    except psycopg.OperationalError as e:
        print(f"\n❌ Connection error: {e}")
        print("\nPlease check:")
        print("  - PostgreSQL is running")
        print("  - Connection details are correct")
        print("  - Database exists")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

def main():
    import argparse
    
    parser = argparse.ArgumentParser(
        description='Export PostgreSQL data to SQL file using Python',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Using default credentials (from codebase)
  python export_from_postgres_python.py
  
  # Custom connection
  python export_from_postgres_python.py --host localhost --user postgres --password mypass --database shabtzak
        """
    )
    
    parser.add_argument('--host', default='localhost', help='PostgreSQL host (default: localhost)')
    parser.add_argument('--port', type=int, default=5432, help='PostgreSQL port (default: 5432)')
    parser.add_argument('--user', default='shabtzak', help='PostgreSQL username (default: shabtzak)')
    parser.add_argument('--password', default='devpass', help='PostgreSQL password (default: devpass)')
    parser.add_argument('--database', default='shabtzak', help='PostgreSQL database name (default: shabtzak)')
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

