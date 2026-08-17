from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session
# from passlib.context import CryptContext
#from passlib.context import CryptContext
from jwt import exceptions
from datetime import datetime, timedelta
from db import get_db, User
from jose import JWTError, jwt

SECRET_KEY = "09d25e094faa6ca2556c818166b7a9563b93f7099f6f0f4caa6cf63b88e8d3e7"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60

#pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
#
# # Password Hashing
#def hash_password(password: str):
#    print(pwd_context.hash(password))
#    return pwd_context.hash(password)


# def verify_password(plain_password, hashed_password):
#     return pwd_context.verify(plain_password, hashed_password)

# Create JWT Token
def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

# Verify JWT Token
def verify_token(token: str,db: Session):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise credentials_exception
        user = get_user_by_email(db, email)
        if user is None:
            raise credentials_exception
        return user
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

# Registration API
# Create a new user with role and hashed password
def register_user(db: Session, username: str, email: str, password: str, role: str = 'user'):
    #hashed_password = hash_password(password)
    new_user = User(username=username, email=email, password=password, role=role)
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return {"message": "User registered successfully"}

# Get user by email (now primary key)
def get_user_by_email(db: Session, email: str):
    return db.query(User).filter(User.email == email).first()

# Get user by username
def get_user_by_username(db: Session, name: str):
    return db.query(User).filter(User.username == name).first()


# Get all users
def get_all_users(db: Session):
    return db.query(User).all()

# Delete user by email (now primary key)
def delete_user(db: Session, email: str):
    user = db.query(User).filter(User.email == email).first()
    if user:
        db.delete(user)
        db.commit()
        return True
    return False

# Edit user details (only Admin can do this)
def edit_user(db: Session, email: str, new_username: str = None, new_role: str = None):
    user = db.query(User).filter(User.email == email).first()
    if not user:
        return None
    if new_username:
        user.username = new_username
    if new_role:
        user.role = new_role
    user.last_updated = datetime.utcnow()  # Update last updated timestamp
    db.commit()
    db.refresh(user)
    return user

# Reset user password (only Admin can do this)
def reset_password(db: Session, email: str, new_password: str):
    user = db.query(User).filter(User.email == email).first()
    if not user:
        return None
    #hashed_password = hash_password(new_password)
    user.password = new_password
    user.last_updated = datetime.utcnow()  # Update last updated timestamp
    db.commit()
    db.refresh(user)
    return user