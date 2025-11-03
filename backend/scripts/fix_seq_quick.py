from sqlalchemy import create_engine, text
import os

engine = create_engine(os.getenv('DATABASE_URL'))
conn = engine.connect()

# Get max ID
max_id = conn.execute(text('SELECT COALESCE(MAX(id), 0) FROM vacations')).scalar()

# Get sequence name
seq_result = conn.execute(text("SELECT pg_get_serial_sequence('vacations', 'id')")).scalar()
if not seq_result:
    print("ERROR: Could not find sequence")
    exit(1)

seq_name = seq_result.split('.')[-1]

# Fix sequence
new_val = max_id + 1
conn.execute(text(f"SELECT setval('{seq_name}', {new_val}, false)"))
conn.commit()

print(f'✓ Fixed vacations sequence: set to {new_val} (max_id was {max_id})')
conn.close()

