# backend/app/routers/friendships.py
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional, Dict
from sqlalchemy import select, insert, delete
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.soldier import Soldier
from app.models.soldier_friendship import SoldierFriendship

router = APIRouter(prefix="/soldiers", tags=["friendships"])

class FriendshipStatus(BaseModel):
    soldier_id: int
    friend_id: int
    status: Optional[str] = None  # 'friend', 'not_friend', or None (neutral)

class FriendshipUpdateRequest(BaseModel):
    friendships: List[FriendshipStatus]  # List of all friendships for a soldier

@router.get("/{soldier_id}/friendships")
def get_soldier_friendships(soldier_id: int, db: Session = Depends(get_db)):
    """Get all friendships for a soldier."""
    # Verify soldier exists
    soldier = db.execute(select(Soldier).where(Soldier.id == soldier_id)).scalar_one_or_none()
    if not soldier:
        raise HTTPException(status_code=404, detail="Soldier not found")
    
    # Get all soldiers
    all_soldiers = db.execute(select(Soldier).order_by(Soldier.name)).scalars().all()
    
    # Get existing friendships
    friendships = db.execute(
        select(SoldierFriendship).where(SoldierFriendship.soldier_id == soldier_id)
    ).scalars().all()
    
    # Build a map of friend_id -> status
    friendship_map: Dict[int, str] = {}
    for f in friendships:
        friendship_map[f.friend_id] = f.status
    
    # Build response: all soldiers with their friendship status
    result = []
    for s in all_soldiers:
        if s.id == soldier_id:
            continue  # Skip self
        result.append({
            "soldier_id": soldier_id,
            "friend_id": s.id,
            "friend_name": s.name,
            "status": friendship_map.get(s.id)  # 'friend', 'not_friend', or None
        })
    
    return {"friendships": result}

@router.put("/{soldier_id}/friendships")
def update_soldier_friendships(soldier_id: int, request: FriendshipUpdateRequest, db: Session = Depends(get_db)):
    """Update friendships for a soldier. Creates bidirectional relationships."""
    # Verify soldier exists
    soldier = db.execute(select(Soldier).where(Soldier.id == soldier_id)).scalar_one_or_none()
    if not soldier:
        raise HTTPException(status_code=404, detail="Soldier not found")
    
    # Build a map of friend_id -> status from request
    friendship_updates: Dict[int, Optional[str]] = {}
    for f in request.friendships:
        if f.soldier_id != soldier_id:
            raise HTTPException(status_code=400, detail=f"Invalid soldier_id in friendship: expected {soldier_id}")
        if f.friend_id == soldier_id:
            continue  # Skip self-friendships
        friendship_updates[f.friend_id] = f.status
    
    # Verify all friend_ids exist
    friend_ids = list(friendship_updates.keys())
    if friend_ids:
        existing_soldiers = db.execute(
            select(Soldier.id).where(Soldier.id.in_(friend_ids))
        ).scalars().all()
        missing = set(friend_ids) - set(existing_soldiers)
        if missing:
            raise HTTPException(status_code=400, detail=f"Soldiers not found: {missing}")
    
    # Delete existing friendships for this soldier
    db.execute(delete(SoldierFriendship).where(SoldierFriendship.soldier_id == soldier_id))
    
    # Delete reverse friendships (where friend_id == soldier_id)
    db.execute(delete(SoldierFriendship).where(SoldierFriendship.friend_id == soldier_id))
    
    # Create new friendships (bidirectional)
    for friend_id, status in friendship_updates.items():
        if status is None:
            continue  # Skip neutral (no relationship)
        
        if status not in ['friend', 'not_friend']:
            raise HTTPException(status_code=400, detail=f"Invalid status: {status}. Must be 'friend' or 'not_friend'")
        
        # Create bidirectional relationship
        # Forward: soldier_id -> friend_id
        db.execute(
            insert(SoldierFriendship).values(
                soldier_id=soldier_id,
                friend_id=friend_id,
                status=status
            )
        )
        # Reverse: friend_id -> soldier_id
        db.execute(
            insert(SoldierFriendship).values(
                soldier_id=friend_id,
                friend_id=soldier_id,
                status=status
            )
        )
    
    db.commit()
    return {"message": "Friendships updated successfully"}

