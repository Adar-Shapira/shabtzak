#!/usr/bin/env python3
"""
Import data from PostgreSQL SQL dump into SQLite database.
This script parses a PostgreSQL dump file and imports the data into SQLite.
"""

import os
import re
import sys
import sqlite3

def convert_pg_to_sqlite(sql_line: str) -> str:
    """Convert PostgreSQL SQL to SQLite-compatible SQL."""
    # Remove schema prefix (public.)
    sql_line = re.sub(r'public\.(\w+)', r'\1', sql_line)
    
    # Convert PostgreSQL timestamps to SQLite format
    # PostgreSQL: '2025-10-16 07:31:38.321082+00' or '2025-10-16 07:31:38.321082:00'
    # SQLite: '2025-10-16 07:31:38.321082'
    sql_line = re.sub(r"(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+)[+:]\d{2}", r"\1", sql_line)
    sql_line = re.sub(r"(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})[+:]\d{2}", r"\1", sql_line)
    
    return sql_line

def import_data(sql_file: str, db_path: str):
    """Import data from PostgreSQL SQL dump into SQLite database."""
    
    print(f"[import] Reading SQL file: {sql_file}")
    print(f"[import] Target database: {db_path}")
    
    # Connect to SQLite
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = OFF")  # Disable foreign keys temporarily for faster import
    cursor = conn.cursor()
    
    # Track statistics
    tables_seen = set()
    insert_count = 0
    error_count = 0
    
    with open(sql_file, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Split into lines and process
    lines = content.split('\n')
    
    for line in lines:
        line = line.strip()
        
        # Skip comments and empty lines
        if not line or line.startswith('--') or line.startswith('SET ') or line.startswith('SELECT '):
            continue
        
        # Skip alembic_version (migration management)
        if 'alembic_version' in line:
            continue
        
        # Convert PostgreSQL syntax to SQLite
        sql_line = convert_pg_to_sqlite(line)
        
        # Check if it's an INSERT statement
        if not sql_line.upper().startswith('INSERT INTO'):
            continue
        
        # Extract table name
        match = re.match(r'INSERT INTO (\w+)', sql_line, re.IGNORECASE)
        if not match:
            continue
        
        table = match.group(1)
        
        if table not in tables_seen:
            print(f"[import] Importing {table}...")
            tables_seen.add(table)
        
        # Replace INSERT INTO with INSERT OR REPLACE INTO to update existing records
        sql_line = re.sub(r'INSERT INTO', 'INSERT OR REPLACE INTO', sql_line, flags=re.IGNORECASE)
        
        try:
            # Execute the SQL statement directly
            cursor.execute(sql_line)
            insert_count += 1
            
            if insert_count % 100 == 0:
                conn.commit()
                print(f"[import] Committed {insert_count} inserts...")
                
        except sqlite3.Error as e:
            error_count += 1
            print(f"[import] Error inserting into {table} (error #{error_count}): {e}")
            print(f"[import] SQL: {sql_line[:150]}...")
            conn.rollback()
            # Continue with next insert
    
    # Final commit
    conn.commit()
    conn.execute("PRAGMA foreign_keys = ON")  # Re-enable foreign keys
    conn.close()
    
    print(f"[import] Import complete!")
    print(f"[import] Total inserts: {insert_count}")
    print(f"[import] Errors: {error_count}")

def main():
    import argparse
    
    parser = argparse.ArgumentParser(description='Import PostgreSQL dump into SQLite')
    parser.add_argument('sql_file', help='Path to SQL dump file')
    parser.add_argument('--db', required=True, help='Path to SQLite database file')
    
    args = parser.parse_args()
    
    if not os.path.exists(args.sql_file):
        print(f"Error: SQL file not found: {args.sql_file}")
        sys.exit(1)
    
    import_data(args.sql_file, args.db)

if __name__ == '__main__':
    main()
