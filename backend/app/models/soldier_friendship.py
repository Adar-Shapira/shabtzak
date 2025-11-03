# backend/app/models/soldier_friendship.py
from sqlalchemy import Column, Integer, ForeignKey, String, UniqueConstraint, CheckConstraint
from sqlalchemy.orm import relationship
from app.db import Base

class SoldierFriendship(Base):
    __tablename__ = "soldier_friendships"

    id = Column(Integer, primary_key=True)
    soldier_id = Column(Integer, ForeignKey("soldiers.id", ondelete="CASCADE"), nullable=False)
    friend_id = Column(Integer, ForeignKey("soldiers.id", ondelete="CASCADE"), nullable=False)
    status = Column(String(20), nullable=False)  # 'friend' or 'not_friend'
    
    soldier = relationship("Soldier", foreign_keys=[soldier_id], back_populates="friendships")
    
    __table_args__ = (
        UniqueConstraint("soldier_id", "friend_id", name="uq_soldier_friendship"),
        CheckConstraint("soldier_id != friend_id", name="chk_no_self_friendship"),
        CheckConstraint("status IN ('friend', 'not_friend')", name="chk_valid_friendship_status"),
    )

