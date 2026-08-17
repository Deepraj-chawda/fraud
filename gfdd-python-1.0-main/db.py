from sqlalchemy import Column, Integer, String, create_engine, DateTime
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from datetime import datetime
import os

DATABASE_URL = "sqlite:///./fraudDB.db"  # SQLite database URL

Base = declarative_base()

# User model with email as the primary key
class User(Base):
    __tablename__ = 'users'
    email = Column(String, primary_key=True, index=True)  # Email as the primary key
    username = Column(String, unique=True, index=True)
    password = Column(String)
    role = Column(String, default='user')  # Role can be 'admin' or 'user'
    last_updated = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

# Create the database engine
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Create tables
if not os.path.exists("./fraudDB.db"):
    Base.metadata.create_all(bind=engine)
    print("Database not found. Creating tables...")
else:
    print("Database found...")

# Dependency for getting DB session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

