"""Daybook FastAPI server: authenticated, cross-device PostgreSQL storage."""

from __future__ import annotations

import os
import secrets
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Generator
from uuid import uuid4

from fastapi import Depends, FastAPI, HTTPException, Response, status
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
import bcrypt
from pydantic import BaseModel, EmailStr, Field
from dotenv import load_dotenv
from sqlalchemy import DateTime, ForeignKey, String, create_engine, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker


BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")
DATABASE_URL = os.getenv("DATABASE_URL") or os.getenv("POSTGRES_URL") or "postgresql+psycopg://daybook@127.0.0.1:5433/daybook"
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = "postgresql+psycopg://" + DATABASE_URL[len("postgres://"):]
elif DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = "postgresql+psycopg://" + DATABASE_URL[len("postgresql://"):]
SESSION_DAYS = 30
COOKIE_NAME = "daybook_session"
engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    tracker_data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=lambda: default_tracker_data())
    sessions: Mapped[list["LoginSession"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class LoginSession(Base):
    __tablename__ = "login_sessions"

    token: Mapped[str] = mapped_column(String(128), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    user: Mapped[User] = relationship(back_populates="sessions")


def default_tracker_data() -> dict:
    return {"startDate": None, "endDate": None, "totalBudget": None, "expenses": [], "earnings": []}


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))


class Expense(BaseModel):
    id: str = Field(max_length=100)
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    name: str = Field(min_length=1, max_length=60)
    price: float = Field(gt=0)


class Earning(BaseModel):
    id: str = Field(max_length=100)
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    name: str = Field(min_length=1, max_length=60)
    amount: float = Field(gt=0)


class TrackerData(BaseModel):
    startDate: str | None = None
    endDate: str | None = None
    totalBudget: float | None = Field(default=None, gt=0)
    expenses: list[Expense] = Field(default_factory=list)
    earnings: list[Earning] = Field(default_factory=list)


class RegisterRequest(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class PublicUser(BaseModel):
    id: str
    name: str
    email: str


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def public_user(user: User) -> dict:
    return {"id": user.id, "name": user.name, "email": user.email}


def create_login(response: Response, user: User, db: Session) -> None:
    token = secrets.token_urlsafe(48)
    expires_at = datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)
    db.add(LoginSession(token=token, user_id=user.id, expires_at=expires_at))
    db.commit()
    response.set_cookie(
        COOKIE_NAME, token, max_age=SESSION_DAYS * 86400, httponly=True,
        samesite="lax", secure=os.getenv("COOKIE_SECURE", "false").lower() == "true",
    )


def current_user(session_token: str | None = None, db: Session = Depends(get_db)) -> User:
    if not session_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Please log in.")
    login = db.scalar(select(LoginSession).where(LoginSession.token == session_token))
    if not login or login.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Your session has expired.")
    return login.user


# Explicit cookie dependency keeps API endpoint signatures clear.
from fastapi import Cookie  # noqa: E402


def require_user(daybook_session: str | None = Cookie(default=None), db: Session = Depends(get_db)) -> User:
    return current_user(daybook_session, db)


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(title="Daybook", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=BASE_DIR), name="static")


@app.get("/", include_in_schema=False)
def homepage() -> FileResponse:
    return FileResponse(BASE_DIR / "index.html")


@app.post("/api/auth/register")
def register(payload: RegisterRequest, response: Response, db: Session = Depends(get_db)) -> dict:
    email = str(payload.email).lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status_code=409, detail="An account already exists for this email.")
    user = User(name=payload.name.strip(), email=email, password_hash=hash_password(payload.password))
    db.add(user)
    db.commit()
    db.refresh(user)
    create_login(response, user, db)
    return {"user": public_user(user), "data": user.tracker_data}


@app.post("/api/auth/login")
def login(payload: LoginRequest, response: Response, db: Session = Depends(get_db)) -> dict:
    user = db.scalar(select(User).where(User.email == str(payload.email).lower()))
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Email or password is incorrect.")
    create_login(response, user, db)
    return {"user": public_user(user), "data": user.tracker_data}


@app.post("/api/auth/logout", status_code=204)
def logout(response: Response, daybook_session: str | None = Cookie(default=None), db: Session = Depends(get_db)) -> Response:
    if daybook_session:
        login = db.get(LoginSession, daybook_session)
        if login:
            db.delete(login)
            db.commit()
    response.delete_cookie(COOKIE_NAME)
    return response


@app.get("/api/me")
def me(user: User = Depends(require_user)) -> dict:
    return {"user": public_user(user), "data": user.tracker_data}


@app.put("/api/data")
def save_data(payload: TrackerData, user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    user.tracker_data = payload.model_dump()
    db.commit()
    return {"ok": True}
