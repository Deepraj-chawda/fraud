from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, status, Form, Query, Body
from sqlalchemy.orm import Session
from fastapi.responses import JSONResponse, FileResponse, StreamingResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from db import get_db, User # Importing DB session helper
from auth import (create_access_token, register_user, get_user_by_email, get_all_users, delete_user,
                  verify_token, edit_user, reset_password, get_user_by_username) # Importing authentication logic
from exif_api import extract_exif  # Custom EXIF extraction logic
from header_api import extract_header  # Custom Header extraction logic
import os
from pydantic import BaseModel, Field
import logging
from datetime import datetime, timedelta
from fastapi.middleware.cors import CORSMiddleware
from detect_AI_new import detect_ai_image, DetectionResult
import shutil
import tempfile
from typing import Dict, Any, List, Optional, Literal
from facecomparison import process_single_file, compare_faces, FaceCompareInput, FolderComparisonResult
from pixel_analysis import ModeType, get_pixel_stats, compute_pixel_stats, FileAnalysisResult, ImageStatsResponse, ImageStatsInput, MODE_THRESHOLDS
import base64
import cv2
import csv
from pdf2image import convert_from_path
from copymove import process_image, process_image_no_async,CopyDetectionResult,CopyMoveFormInput
from edge_detection import process_echo_edge, EchoEdgeResult, EchoEdgeFormInput, process_echo_edge_no_async
from error_level import apply_ela_processing,apply_ela_processing_no_async, ElaResponse, ElaRequest
from pca_analysis import process_pca, PCAResult, PCAInput, AnalysisResults
from pathlib import Path
import pathlib
from task_progress import get_progress, add_progress, update_progress
import uuid
import mimetypes
from PIL import Image
import fitz
import threading
import time
from fastapi.background import BackgroundTasks
from combined_analysis import cal_combined_analysis,cal_combined_analysis_no_async, CombinedResult, CombineInput,CombinFileAnalysisResult, CombinPCAResult, MODE_THRESHOLDS_, CombinEchoResult
import pytesseract
import io
import re
import numpy as np
import asyncio
import hashlib
import asyncpg
from module_monitor import ModuleMonitorService


# Initialize FastAPI application
app = FastAPI()

# ===== 1. Tesseract路径自动适配（重要！）=====
if os.name == 'nt':  # Windows系统
    win_path = r'D:\fiverr\Tesseract-OCR\tesseract.exe'
    
    # 验证路径有效性
    if pathlib.Path(win_path).exists():
        pytesseract.pytesseract.tesseract_cmd = win_path
    else:
        raise FileNotFoundError(f"Windows Tesseract路径不存在: {win_path}")
else:
    # 自动探测常见安装路径
    possible_paths = [
        '/usr/bin/tesseract',        # 标准Linux路径
        '/usr/local/bin/tesseract',   # macOS/homebrew路径
        '/opt/homebrew/bin/tesseract' # M系列Mac专用路径
    ]
    
    found = False
    for path in possible_paths:
        if pathlib.Path(path).exists():
            pytesseract.pytesseract.tesseract_cmd = path
            found = True
            break
    
    # 相对路径后备方案
    if not found:
        project_dir = pathlib.Path(__file__).parent.resolve()
        rel_path = project_dir / 'tesseract_linux' / 'tesseract'
        if rel_path.exists():
            pytesseract.pytesseract.tesseract_cmd = str(rel_path)
        else:
            # 最终解决方案
            try:
                # 尝试使用系统PATH环境变量
                pytesseract.pytesseract.tesseract_cmd = 'tesseract'
            except EnvironmentError:
                raise RuntimeError("Tesseract未安装或路径配置错误")
# 数据库连接池
#DATABASE_URL = "postgresql://pgadmin:1qaz2wsx!EDX@rds-pg-instance-a.c7aii6qy2hal.ap-east-1.rds.amazonaws.com:5432/rdspgdatabase"
DATABASE_URL ="postgresql://user1:admin@localhost:5433/frauddb"

@app.on_event("startup")
async def startup():
    app.state.pool = await asyncpg.create_pool(DATABASE_URL)

@app.on_event("shutdown")
async def shutdown():
    await app.state.pool.close()

result_store = {}  # 存储结果信息
exif_progress_store = {}
# 线程锁保证线程安全
progress_lock = threading.Lock()
# 全局进度存储字典
progress_store = {}  # 存储进度信息
result_store = {}  # 存储结果信息
# 过期时间配置(单位：小时)
PROGRESS_EXPIRE_HOURS = 1

# Define a Pydantic model for the User response
class UserResponse(BaseModel):
    email: str  # 用户邮箱
    username: str  # 用户密码
    password: str
    role: str  # 用户角色
    last_updated: datetime  # 最后更新时间

    class Config:
        orm_mode = True  # This will tell Pydantic to treat SQLAlchemy objects as data models

class LoginInput(BaseModel):
    email: str
    password: str


# Define the allowed origins for CORS
origins = [
    "*",  # Allows all origins, you can restrict this to specific domains if needed
]

# Add CORS middleware to allow access from any website
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,  # List of allowed origins
    allow_credentials=True,  # Allow cookies and credentials
    allow_methods=["*"],  # Allow all HTTP methods
    allow_headers=["*"],  # Allow all headers
)

# Set up logging for error reporting
logging.basicConfig(filename="fraud_api_logs.log",level=logging.ERROR)
logger = logging.getLogger(__name__)

# OAuth2 Password Bearer Scheme for Token-based Authentication
#oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")
# HTTPBearer authentication for Token-based Authorization
auth_scheme = HTTPBearer()


#
# ADD THESE MODELs for results
#
class PageResultDetail(BaseModel):
    page_number: int
    detection_status: str
    analysis:Any  # This will hold the full analysis JSON

class DocumentResultDetail(BaseModel):
    document_id: int
    filename: str
    filetype: str
    filesize: int
    pages: List[PageResultDetail] # A list of all pages for this document

class BatchResultResponse(BaseModel):
    batch_id: int
    batch_name: str
    created_at: datetime
    documents: List[DocumentResultDetail] # A list of all documents

# Helper function to save uploaded image
def save_uploaded_image(uploaded_file: UploadFile):
    """
    保存上传的文件（图片、PDF等）到 static 文件夹，自动生成唯一文件名。

    Args:
        uploaded_file (UploadFile): 上传的文件对象。

    Returns:
        str: 文件保存路径。

    Raises:
        HTTPException: 保存失败时抛出。
    """
    try:
        upload_folder = 'static'
        if not os.path.exists(upload_folder):
            os.makedirs(upload_folder)

        # 获取文件扩展名
        ext = uploaded_file.filename.rsplit('.', 1)[-1].lower() if '.' in uploaded_file.filename else ''
        # 生成唯一文件名，防止覆盖
        unique_name = f"uploaded_{uuid.uuid4().hex}.{ext}" if ext else f"uploaded_{uuid.uuid4().hex}"
        filepath = os.path.join(upload_folder, unique_name)

        # 保存文件
        with open(filepath, 'wb') as f:
            f.write(uploaded_file.file.read())

        return filepath
    except Exception as e:
        logger.error(f"Error saving file: {str(e)}")
        raise HTTPException(status_code=500, detail="Error saving the uploaded file")


# Helper function to extract the current user based on a JWT token
def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(auth_scheme), db: Session = Depends(get_db)):
    """
    Extracts and returns the current user based on the provided JWT token.

    Args:
        token (str): JWT token to identify the user.
        db (Session): Database session dependency.

    Returns:
        User: The user identified by the token.

    Raises:
        HTTPException: If the token is invalid or verification fails.
    """
    # Call verify_token to validate the token and retrieve the user from the database
    token = credentials.credentials

    return verify_token(token,db)



# 1. API to register a new user (Admin only)
@app.post("/adduser")
def register(username: str, email: str, password: str, role: str = 'user',
             db: Session = Depends(get_db)):
    """
    Registers a new user in the system (Admin only).

    Args:
        username (str): The new user's username.
        email (str): The new user's email.
        password (str): The new user's password.
        role (str): The role of the new user (default: 'user').
        db (Session): Database session dependency.
        current_user (User): The authenticated admin user.

    Returns:
        dict: Success message indicating the user was registered.

    Raises:
        HTTPException: If the current user is not an admin (status 403).
    """
    # Check if the current user is an admin before registering a new user
    # if current_user.role.lower() != "admin":
    #     raise HTTPException(status_code=403, detail="Not authorized")

    user = get_user_by_email(db, email)
    if user:
        return {"message": "Email already Registered. Please Try Login"}

    user = get_user_by_username(db, username)
    if user:
        return {"message": "Username already present."}

    # Register the new user using the provided details and return a success message
    return register_user(db, username, email, password, role)


# 2. API to log in a user and generate a JWT token
@app.post("/login")
def login(data: LoginInput, db: Session = Depends(get_db)):
    """
    Authenticates a user and returns a JWT token.

    Args:
        email (str): The user's email.
        password (str): The user's password.
        db (Session): Database session dependency.

    Returns:
        dict: Access token and token type.

    Raises:
        HTTPException: If credentials are invalid (status 400).
    """
    # Fetch the user by email from the database
    email = data.email
    password = data.password

    user = get_user_by_email(db, email)

    # Check if user exists and the password is correct
    if not user or not (password == user.password):
        raise HTTPException(status_code=400, detail="Invalid credentials")

    # Create a JWT token for the authenticated user and return it
    access_token = create_access_token(data={"sub": user.email, "role": user.role})
    return {"access_token": access_token, "token_type": "bearer"}


# 3. API to get a list of all users (Admin only)
@app.get("/getallusers", response_model=List[UserResponse])
def read_users(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    Fetches and returns a list of all registered users (Admin only).

    Args:
        current_user (User): The authenticated user (should be an admin).
        db (Session): Database session dependency.

    Returns:
        List[UserResponse]: A list of all user details.

    Raises:
        HTTPException: If the current user is not an admin (status 403).
    """
    # Check if the current user has admin privileges
    if current_user.role.lower() != "admin":
        raise HTTPException(status_code=403, detail="Not authorized")

    # Fetch and return the list of all users from the database
    users = get_all_users(db)
    return users

# 4. API to delete a user (Admin only)
@app.delete("/delete/{email}")
def delete_user_api(email: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """
    Deletes a user by their email (Admin only).

    Args:
        email (str): The email of the user to delete.
        db (Session): Database session dependency.
        current_user (User): The authenticated admin user.

    Returns:
        dict: A success message indicating the user was deleted.

    Raises:
        HTTPException: If the current user is not an admin or the user is not found (status 404).
    """
    # Check if the current user is an admin
    if current_user.role.lower() != "admin":
        raise HTTPException(status_code=403, detail="Not authorized")

    # Attempt to delete the user by email from the database
    success = delete_user(db, email)

    # If deletion fails, raise an exception indicating the user was not found
    if not success:
        raise HTTPException(status_code=404, detail="User not found")

    # Return a success message if the user is deleted
    return {"detail": "User deleted"}


# 5. API to edit a user's details (Admin only)
@app.put("/edit/{email}")
def edit_user_api(email: str, new_username: str = None, new_role: str = None,
                  db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """
    Edits a user's details (Admin only).

    Args:
        email (str): The email of the user to edit.
        new_username (str): The new username (optional).
        new_role (str): The new role (optional).
        db (Session): Database session dependency.
        current_user (User): The authenticated admin user.

    Returns:
        dict: The updated user details.

    Raises:
        HTTPException: If the current user is not an admin or the user is not found (status 404).
    """
    # Check if the current user is an admin
    if current_user.role.lower() != "admin":
        raise HTTPException(status_code=403, detail="Not authorized")

    # Edit the user's details in the database (username or role)
    user = edit_user(db, email, new_username, new_role)

    # If user editing fails, raise an exception indicating the user was not found
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Return the updated user details
    return user


# 6. API to reset a user's password (Admin only)
@app.put("/reset-password/{email}")
def reset_password_api(email: str, new_password: str,
                       db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """
    Resets a user's password (Admin only).

    Args:
        email (str): The email of the user whose password will be reset.
        new_password (str): The new password.
        db (Session): Database session dependency.
        current_user (User): The authenticated admin user.

    Returns:
        dict: A message indicating the password was updated.

    Raises:
        HTTPException: If the current user is not an admin or the user is not found (status 404).
    """
    # Check if the current user is an admin
    if current_user.role.lower() != "admin":
        raise HTTPException(status_code=403, detail="Not authorized")

    # Reset the password for the specified user
    user = reset_password(db, email, new_password)

    # If resetting the password fails, raise an exception indicating the user was not found
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Return a success message indicating the password was updated
    return {"detail": "Password updated"}

# 7. Header Structure API (JWT Protected)
@app.post('/headerstructure')
async def header(image: UploadFile = File(...), current_user: User = Depends(get_current_user),db: Session = Depends(get_db) ):
    """
    Extracts the HTML header structure from an uploaded image.
    This endpoint is protected with JWT authentication.

    Args:
        image (UploadFile): The uploaded image file containing the header.
        current_user (User): The authenticated user (extracted from JWT).
        db (Session): The database session.

    Returns:
        JSONResponse: JSON object containing the extracted HTML header content.

    Raises:
        HTTPException:
            - 401: If the JWT token is invalid or expired.
            - 404: If no header structure is found in the image.
            - 500: If an internal server error occurs during processing.
    """
    try:


        # Save the uploaded image and process the header extraction
        filepath = save_uploaded_image(image)
        html_content = extract_header(filepath)

        if not html_content:
            raise HTTPException(status_code=404, detail="Header structure not found in the image")

        # Return the extracted HTML content
        return JSONResponse(content={"html_content": html_content})

    except HTTPException as e:
        # Re-raise the handled exception (401, 404)
        raise e
    except Exception as e:
        # Log the internal error and raise a 500 HTTPException
        logger.error(f"Internal Server Error in header structure extraction: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error during header extraction")


# 8. EXIF Data API (JWT Protected)

@app.get('/exif-progress/{session_id}')
def get_exif_progress(session_id: str):
    """
    查询指定会话ID的EXIF/PDF分析进度。
    - 输入会话ID，返回该批次所有文件的处理进度（已完成数、总数、百分比、当前文件名等）。
    - 前端可通过轮询此接口实时获取批量分析进度。

    Query the EXIF/PDF analysis progress for the given session ID.
    - Takes a session ID and returns the processing progress for all files in the batch (finished count, total count, percent, current filename, etc.).
    - The frontend can poll this API to get real-time progress for batch analysis.
    """
    progress = exif_progress_store.get(session_id)
    if not progress:
        return {"finished": 0, "total": 0, "percent": 0, "filename": None}
    return progress


@app.post('/exif')
async def exif_api(files: List[UploadFile] = File(...), db: Session = Depends(get_db)):
    """
    批量提取图片和PDF的EXIF或内容分析，支持多文件上传和进度跟踪。
    - 支持多文件上传：一次可上传多个图片或PDF文件，自动处理每个文件。
    - 支持多种图片格式（如 JPG, HEIC, HEIF）及 PDF 文件：自动识别并分析主流图片格式和PDF。
    - 实时记录和更新每个文件的处理进度：后端会为每个会话分配唯一ID，前端可通过会话ID轮询进度接口获取每个文件的处理进度。
    - 对于PDF文件，能提取每页文本和图片，并为每页生成单独分析报告：PDF会被逐页处理，返回每页的详细内容和分析结果。
    - 返回统一会话ID和所有文件的分析结果，便于前端统一展示和管理：所有结果以会话ID为单位返回，前端可一次性获取所有分析结果。

    Batch extraction of EXIF or content analysis for images and PDFs, supporting multi-file upload and progress tracking.
    - Supports multi-file upload: allows uploading multiple images or PDF files at once, automatically processing each file.
    - Supports various image formats (e.g., JPG, HEIC, HEIF) and PDF files: automatically detects and analyzes mainstream image formats and PDFs.
    - Tracks and updates the processing progress of each file in real time: backend assigns a unique session ID for each batch, frontend can poll the progress API using the session ID to get the progress of each file.
    - For PDF files, extracts text and images from each page and generates a separate analysis report for each page: PDFs are processed page by page, returning detailed content and analysis for each page.
    - Returns a unified session ID and analysis results for all files, facilitating unified display and management on the frontend: all results are returned under a session ID, allowing the frontend to fetch all analysis results at once.
    """
    try:
        file_info_list = []
        # 保存文件并记录原始文件名与保存路径
        for file in files:
            path = save_uploaded_image(file)
            file_info_list.append({"filepath": path, "filename": file.filename})

        # 传递文件路径列表给分析方法
        filepaths = [info["filepath"] for info in file_info_list]
        exif_result = extract_exif(filepaths,session_id=str(uuid.uuid4()))

        # 如果分析结果为列表，补充原始文件名
        if exif_result and "results" in exif_result and isinstance(exif_result["results"], list):
            for i, result in enumerate(exif_result["results"]):
                # 补充原始文件名
                if i < len(file_info_list):
                    result["filename"] = file_info_list[i]["filename"]
        # 如果进度跟踪结构中有 filename 字段，也补充原始文件名
        if "session_id" in exif_result and hasattr(exif_result, "get"):
            session_id = exif_result["session_id"]
            if session_id in exif_progress_store:
                exif_progress_store[session_id]["filename"] = file_info_list[0]["filename"] if file_info_list else None
        if not exif_result or not exif_result.get("results"):
            raise HTTPException(status_code=404, detail="No EXIF/PDF data found in the files")

        # 递归处理结果，将 bytes、PDFStream、PSLiteral、PSKeyword 等不可序列化对象转为字符串或 base64
        import base64
        def make_json_serializable(obj):
            # PDFStream 兼容处理
            if hasattr(obj, 'get_data') and callable(obj.get_data):
                try:
                    data = obj.get_data()
                    return base64.b64encode(data).decode('utf-8')
                except Exception:
                    return str(obj)
            # bytes 直接转 base64
            if isinstance(obj, bytes):
                return base64.b64encode(obj).decode('utf-8')
            # PSLiteral/PSKeyword/其他不可序列化类型统一转字符串
            if obj.__class__.__name__ in ['PSLiteral', 'PSKeyword']:
                return str(obj)
            # dict 递归处理
            if isinstance(obj, dict):
                return {k: make_json_serializable(v) for k, v in obj.items()}
            # list/tuple 递归处理
            if isinstance(obj, (list, tuple)):
                return [make_json_serializable(i) for i in obj]
            # 其他类型直接返回（如 str, int, float, bool, None）
            return obj

        serializable_result = make_json_serializable(exif_result)
        # 返回会话ID和所有分析结果，前端可统一轮询进度
        return JSONResponse(content=serializable_result)
    except HTTPException as e:
        raise e
    except Exception as e:
        import traceback
        err_msg = f"{str(e)}\n{traceback.format_exc()}"
        logger.error(f"Internal Server Error in EXIF/PDF extraction: {err_msg}")
        raise HTTPException(status_code=500, detail=err_msg)


#
# NEW ENDPOINT to get result
#
@app.get("/results/batch/{batch_id}", response_model=BatchResultResponse)
async def get_batch_results_detailed(batch_id: int):
    """
    Fetches all detailed analysis results for every document and page
    within a single batch.
    """
    async with app.state.pool.acquire() as conn:

        # 1. Get Batch Info
        batch_info = await conn.fetchrow(
            "SELECT id, name, created_at FROM batch WHERE id = $1", batch_id
        )
        if not batch_info:
            raise HTTPException(status_code=404, detail="Batch not found")

        # 2. Get all documents and their pages in one query
        query = """
        SELECT
            d.id AS document_id,
            d.filename,
            d.filetype,
            d.filesize,
            p.page_number,
            p.detection_status,
            p.analysis_results  -- This is the column with your JSON data
        FROM
            document d
        JOIN
            page p ON d.id = p.document_id
        WHERE
            d.batch_id = $1
        ORDER BY
            d.filename, p.page_number;
        """

        records = await conn.fetch(query, batch_id)
        if not records:
            # Batch exists but has no processed documents
            return BatchResultResponse(
                batch_id=batch_info['id'],
                batch_name=batch_info['name'],
                created_at=batch_info['created_at'],
                documents=[]
            )

        # 3. Process the records into the nested response structure
        document_map = {}
        for r in records:
            doc_id = r['document_id']

            # If this is the first time we see this document, create its entry
            if doc_id not in document_map:
                document_map[doc_id] = DocumentResultDetail(
                    document_id=doc_id,
                    filename=r['filename'],
                    filetype=r['filetype'],
                    filesize=r['filesize'],
                    pages=[]
                )

            # Add the page to its parent document
            document_map[doc_id].pages.append(
                PageResultDetail(
                    page_number=r['page_number'],
                    detection_status=r['detection_status'],
                    analysis=r['analysis_results']  # This is the full JSON
                )
            )

        # 4. Return the final, structured response
        return BatchResultResponse(
            batch_id=batch_info['id'],
            batch_name=batch_info['name'],
            created_at=batch_info['created_at'],
            documents=list(document_map.values())
        )

#9. Detect AI or NOT API Endpoints
@app.post("/detect-ai-single", response_model=DetectionResult)
async def detect_single_image(
        image: UploadFile = File(...)
        #current_user: dict = Depends(get_current_user)
):
    """Detect if a single uploaded image is AI-generated"""
    try:
        # Save the uploaded file temporarily
        filepath = save_uploaded_image(image)

        # Process the image
        try:
            detection = detect_ai_image(filepath)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Error processing image: {str(e)}")

        # Clean up
        try:
            os.remove(filepath)
        except:
            pass

        return {
            "filename": image.filename,
            "result": detection["result"],
            "real_prob": detection["real_prob"],
            "ai_prob": detection["ai_prob"]
        }
    except HTTPException as e:
        raise e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

#10. Detect AI or NOT folder API Endpoints

@app.post("/detect-ai-images", response_model=Dict[str, Any])
async def detect_images(
        files: List[UploadFile] = File(...),
        monitor: ModuleMonitorService = Depends(lambda: ModuleMonitorService(app.state.pool))
        #current_user: dict = Depends(get_current_user)
):
    """Detect AI in multiple uploaded images"""
    try:
        results = {
            "images": [],
            "total_files": 0,
            "real_count": 0,
            "ai_count": 0,
            "error_images": []
        }
        file_results = []  # 新增：用于构建 save_analysis_results 需要的 files 参数
        # Create a temporary directory for processing
        temp_dir = tempfile.mkdtemp()

        for file in files:
            try:
                # Save the uploaded file temporarily
                file_path = os.path.join(temp_dir, file.filename)
                with open(file_path, "wb") as f:
                    f.write(file.file.read())

                # 创建文件级存储结构
                file_result = {
                    "filename": file.filename,
                    "filepath": file_path,
                    "filesize": os.path.getsize(file_path),
                    "type": file.content_type,
                    "pages": []  # 存储页面结果
                }

                # Only process image files
                if file.filename.lower().endswith(('.jpg', '.jpeg', '.png', '.svg', '.bmp', '.gif', '.tiff', '.tif')):
                    try:
                        detection = detect_ai_image(file_path)
                        if detection["result"] == "real":
                            results["real_count"] += 1
                        else:
                            results["ai_count"] += 1

                        results["images"].append({
                            "filename": file.filename,
                            "result": detection["result"],
                            "real_probability": detection["real_prob"],
                            "ai_probability": detection["ai_prob"],
                            "alert":detection["alert"],
                            "alert_message":detection["alert_message"]
                        })

                        # 构建页面结果
                        page_result = {
                            "page": 1,
                            "text_content": "",
                            "analysis": {
                                "result": detection["result"],
                                "real_prob": detection["real_prob"],
                                "ai_prob": detection["ai_prob"],
                                "alert": detection["alert"],
                                "alert_message": detection["alert_message"]
                            },
                            "detection_status": "processed"  # 可改为实际状态
                        }
                        file_result["pages"].append(page_result)
                    except Exception as e:
                        results["error_images"].append({
                            "filename": file.filename,
                            "error": str(e)
                        })
                elif file.filename.lower().endswith('.pdf'):
                    # Process PDF
                    try:
                        doc = fitz.open(file_path)
                        for i, page in enumerate(doc):
                            # 使用英文文件名
                            base_filename = "page" + str(i + 1)
                            pix = page.get_pixmap()
                            tmp_img_path = os.path.join(temp_dir, f"{base_filename}.jpg")
                            tmp_img_path = os.path.abspath(tmp_img_path)  # 使用绝对路径
                            pix.save(tmp_img_path)
                            pix = None  # 及时释放内存

                            # 调用AI检测
                            detection = detect_ai_image(tmp_img_path)

                            # 构建页面结果
                            page_result = {
                                "page": i + 1,
                                "text_content": "",  # 可添加OCR文本
                                "analysis": {
                                    "result": detection["result"],
                                    "real_prob": detection["real_prob"],
                                    "ai_prob": detection["ai_prob"],
                                    "alert": detection["alert"],
                                    "alert_message": detection["alert_message"]
                                },
                                "detection_status": "processed"  # 可改为实际状态
                            }
                            
                            file_result["pages"].append(page_result)

                            # 记录结果（含页码信息）
                            results["images"].append({
                                "filename": f"{file.filename}_page{i + 1}",
                                "original_filename": file.filename,
                                "page": i + 1,
                                "result": detection["result"],
                                "real_probability": detection["real_prob"],
                                "ai_probability": detection["ai_prob"],
                                "alert":detection["alert"],
                                "alert_message":detection["alert_message"]
                            })

                            # 更新计数
                            if detection["result"] == "real":
                                results["real_count"] += 1
                            else:
                                results["ai_count"] += 1
                            
                        doc.close()
                    except Exception as e:
                            results["error_images"].append({
                                "filename": f"{file.filename}_page{i + 1}",
                                "error": f"Page processing error: {str(e)}"
                            })
                    finally:
                        # 删除临时图片
                        try:
                            os.remove(tmp_img_path)
                        except: pass
                file_results.append(file_result)
            except Exception as e:
                results["error_images"].append({
                    "filename": file.filename,
                    "error": str(e)
                })
            finally:
                # Clean up the uploaded file
                try:
                    os.remove(file_path)
                except:
                    pass

        # Clean up the temporary directory
        try:
            shutil.rmtree(temp_dir)
        except:
            pass

        results["total_files"] = len(results["images"])
        # 在同一个事务中执行监控和文档存储
        async with monitor.pool.acquire() as conn:
            async with conn.transaction():
                # 保存分析结果
                await monitor.save_analysis_results(
                    #user_id=current_user["id"],
                    user_id=1,
                    files=file_results,
                    module_name="AI Integrity Check Analysis",
                    conn=conn
                )
                
                # 更新模块统计（使用同一个连接）
                await monitor.update_module_stats(
                    module_name="AI Integrity Check",
                    is_success=True,
                    conn=conn
                )
        return results

    except HTTPException as e:
        is_success = False  
        await monitor.update_module_stats(
            module_name="AI Integrity Check",
            is_success=is_success
        )
        raise e
    except Exception as e:
        is_success = False  
        await monitor.update_module_stats(
            module_name="AI Integrity Check",
            is_success=is_success
        )
        raise HTTPException(status_code=500, detail=str(e))


#11. face recognition API Endpoints
@app.post("/compare-faces", response_model=Dict[str, Any])
async def compare_files(
        data: FaceCompareInput = Depends(FaceCompareInput.as_form),
        current_user: dict = Depends(get_current_user)
):
    """Compare faces between multiple input and comparison files"""
    try:
        results = {

            "threshold": data.threshold,
            "total_matches": 0,
            "matches": [],
            "errors": []
        }

        # Create temporary directories
        input_temp_dir = tempfile.mkdtemp()
        compare_temp_dir = tempfile.mkdtemp()
        output_dir = os.path.join(os.getcwd(), "Matched_files")
        os.makedirs(output_dir, exist_ok=True)

        # Save and process input files
        input_images = []
        for input_file in data.input_files:
            try:
                file_path = os.path.join(input_temp_dir, input_file.filename)
                with open(file_path, "wb") as f:
                    f.write(input_file.file.read())

                # Process file (PDF or image)
                images = process_single_file(file_path)
                if images:
                    input_images.append({
                        "original_filename": input_file.filename,
                        "file_path": file_path,
                        "extracted_images": images
                    })
                else:
                    results["errors"].append(f"Error processing compare file : {input_file.filename}")
            except Exception as e:
                results["errors"].append(f"Error processing input file {input_file.filename}: {str(e)}")

        # Save and process compare files
        compare_images = []
        for compare_file in data.compare_files:
            try:
                file_path = os.path.join(compare_temp_dir, compare_file.filename)
                with open(file_path, "wb") as f:
                    f.write(compare_file.file.read())

                # Process file (PDF or image)
                images = process_single_file(file_path)
                if images:
                    compare_images.append({
                        "original_filename": compare_file.filename,
                        "file_path": file_path,
                        "extracted_images": images
                    })
                else:
                    results["errors"].append(f"Error processing compare file : {compare_file.filename}")
            except Exception as e:
                results["errors"].append(f"Error processing compare file {compare_file.filename}: {str(e)}")

        # Compare images
        for input_item in input_images:
            input_dir = os.path.join(output_dir, input_item["original_filename"].replace('.', '_'))
            os.makedirs(input_dir, exist_ok=True)

            for compare_item in compare_images:
                match_result = None

                for img1 in input_item["extracted_images"]:
                    for img2 in compare_item["extracted_images"]:
                        #print(input_item["original_filename"],compare_item["original_filename"], match_result)
                        try:
                            face_data = compare_faces(img1, img2)
                            if face_data.get('error', False):
                                #results["errors"].append(face_data['error'])
                                continue

                            if face_data['verified']:
                                distance_accuracy = abs(0.1 - face_data.get("distance", 0.1)) * 1000
                                match_result = {
                                    "input_file": input_item["original_filename"],
                                    "compare_file": compare_item["original_filename"],
                                    "matched": distance_accuracy >= data.threshold,
                                    "distance": face_data.get("distance", 0.1),
                                    "threshold": data.threshold,
                                    "result": distance_accuracy
                                }

                                if match_result["matched"]:
                                    results["total_matches"] += 1
                                    # Copy matched file
                                    dest_path = os.path.join(input_dir, compare_item["original_filename"])
                                    shutil.copyfile(compare_item["file_path"], dest_path)
                                    break
                        except Exception as e:

                            continue

                        if match_result and match_result["matched"]:
                            break
                    if match_result and match_result["matched"]:
                        break

                if match_result:
                    results["matches"].append(match_result)

        # Clean up
        shutil.rmtree(input_temp_dir)
        shutil.rmtree(compare_temp_dir)

        return results

    except HTTPException as e:
        raise e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# 1. Image Statistics - Pixel Statistics
ALERT_IMAGE_DIR = "alert_images"
os.makedirs(ALERT_IMAGE_DIR, exist_ok=True)

@app.post("/image-stats",response_model=ImageStatsResponse)
async def calculate_image_stats(
        files: List[UploadFile] = File(...),
        data: ImageStatsInput = Depends(ImageStatsInput.as_form),
        #current_user: dict = Depends(get_current_user)
):
    """
    # Calculate RGB channel statistics
    Minimum, Average, or Maximum Percentage of RGB color for an image
    Each pixel compare red, green and blue values.
    For a pixel, we find out the value of the channel by following method:
    1. Minimum, if a color is smallest among three colors in a single pixel, that pixel is considered as the channel of that pixel
    1. Minimum, Pixel is counted ioif the channlel is close to the average of all three channels
    3. Maximum, if a color is largest among three colors in a single pixel, that pixel is considered as the channel of that pixel

    Decision Rule:
    If the color percentage of the image is larger than the threshold value, an alert will then be generated.

    Minimum Mode: 28% threshold.
    Average Mode: 30% threshold. 
    Maximum Mode: 38% threshold. 
    Standard deviation: >20 for minimum, 30-90 for average, <100 for maximum

    Number of alerts, color distribution and processed image will be returned.
    """
    
    temp_dir = tempfile.mkdtemp()
    results = []
    alert_pages_total = 0
    total_alerts = 0
    thresholds_used = MODE_THRESHOLDS # Include all modes
    alert_images = []
    errors = []
    modes = ["minimum", "average", "maximum"]


    for i, file in enumerate(files):
        try:
            # Ensure filename is safe
            safe_filename = Path(file.filename).name
            file_path = os.path.join(temp_dir, safe_filename)

            # Save file safely
            os.makedirs(temp_dir, exist_ok=True)
            with open(file_path, "wb") as f:
                f.write(await file.read())

            # Re-open as UploadFile-style object (simulate what FastAPI do)
            with open(file_path, "rb") as f:
                upload = UploadFile(filename = safe_filename, file = f)
                stats_results, alert_count, _ = compute_pixel_stats(
                    upload, modes, data.inclusive, save_alert_images = True, save_dir = temp_dir
                )

                alert_pages_total += alert_count
                if alert_count > 0:
                    alert_images.append(file.filename)

                results.append(FileAnalysisResult(
                    filename = safe_filename, 
                    #image = safe_filename,
                    stats = stats_results
                    ))
                
        except Exception as e:
            error_message = f"Error in file {i+1} ({file.filename}):{str(e)}"
            print(error_message)
            errors.append(error_message)
            continue
                
    # Debug Print
    print(f"Processed {len(results)} files, {len(errors)} errors")

    # Final Response
    return ImageStatsResponse(
        total_alerts = alert_pages_total,
        results = results,
        alert_images = alert_images,
        thresholds_used = thresholds_used
    )

# 2. Image Analysis - PCA Analysis
@app.post("/pca/", response_model=AnalysisResults)
async def process_pca_with_params(
    files: List[UploadFile] = File(...),
    data: PCAInput = Depends()
    #current_user: dict = Depends(get_current_user)
):
    """
    # Perform Principal Component Analysis on RGB Channel
    Principal Component Analysis (PCA) Projection uses colour PCA to project pixel values onto the most salient components. 
    This technique helps in identifying patterns and anomalies within the image that might indicate tampering or manipulation. 
    By analysing the principal components, we can detect unusual variations in pixel values that deviate from the norm.

    Mode:
    Distance: Measure orthogonal distance from the PC vector - useful in pixel-level anomalies (fake pixel, sudden color change)
    Projection: Measure similarity along PC vector - useful for content pattern shift (manipulated region structure)

    Component:
    #1: Dominant color pattern
    #2: Secondary pattern

    Decision Rule:
    1. Eigenvalue: High Variance in Principal Components
    2. Eigenvector: Unusual Eigenvector Directions
    3. Meanvector: Mean Vector Anomalies
    4. Distance Map: detect inconsistence in how color pixel align with PC. Fake document introduce irregularities that inflate distance between RGB pixels and PCA direction vectors
    5. Projection Map: Real document usually has diverse pixel pattern. Flatness in the projection space suggest copy -paste or synthetic areas.

    Thresholds:
    Meanvector: Trigger if any mean value < 0 or > 255
    Eignevector: trigger if L2 norm (magnitude) is not in range of [0.85, 1.15]
    """
    # Create a temp directory
    temp_dir = tempfile.mkdtemp()

    results: List[PCAResult] = []
    #results = []
    errors = []

    for i, file in enumerate(files):
        try:
            file_results = process_pca(
                uploaded_file=file,
                component=data.component,
                mode=data.mode,
                invert=data.invert,
                equalize=data.equalize
            )
            if file_results:
                results.extend(file_results)
        except Exception as e:
            error_message = f"Error in file {i+1} ({file.filename}):{str(e)}"
            print(error_message)
            errors.append(error_message)
            continue
    total_alerts = sum(result.alert for result in results)

    return AnalysisResults(
        total_alerts = total_alerts,
        results = results,
        component= data.component,
        mode=data.mode,
        invert=data.invert,
        equalize=data.equalize
        )

@app.post("/detect-copy-move", response_model=Dict[str, Any])
async def detect_copy_move_api(
        data: CopyMoveFormInput = Depends(CopyMoveFormInput.as_form),
        monitor: ModuleMonitorService = Depends(lambda: ModuleMonitorService(app.state.pool))
        #current_user: User = Depends(get_current_user)
):
    """
    支持多种图片格式（JPG, HEIC, HEIF）和PDF的复制粘贴伪造检测，支持批量上传和实时进度跟踪。
    - 支持多文件上传：一次可上传多个图片或PDF文件，自动处理每个文件。
    - 支持多种图片格式及PDF：PDF每页自动转图片并检测。
    - 实时记录和更新每个文件的处理进度，返回会话ID，前端可轮询进度接口。
    - 返回每个文件（或PDF每页）的检测结果和处理后的图片（base64）。
    """
    
    temp_dir = tempfile.mkdtemp()
    results = []

    try:
        for i, file in enumerate(data.files):
            filename = file.filename
            file_path = os.path.join(temp_dir, filename)

            with open(file_path, "wb") as f:
                f.write(file.file.read())

            mimetype, _ = mimetypes.guess_type(file_path)
            file_result = {"filename": filename, "type": None, "analysis": []}

            mask_path = None
            if data.mask and data.use_mask:
                mask_path = os.path.join(temp_dir, data.mask.filename)
                with open(mask_path, "wb") as f:
                    f.write(data.mask.file.read())

            try:
                if mimetype and mimetype.startswith("image"):
                    file_result["type"] = "image"
                    result = process_image_no_async(
                        image_path=file_path,
                        detector_type=data.detector,
                        response_threshold=data.response_threshold,
                        matching_threshold=data.matching_threshold,
                        distance_threshold=data.distance_threshold,
                        cluster_size=data.cluster_size,
                        show_keypoints=data.show_keypoints,
                        hide_lines=data.hide_lines,
                        mask_path=mask_path,
                        use_mask=data.use_mask,
                        anti_forensics=data.anti_forensics
                    )
                    if "error" in result:
                        file_result["error"] = result["error"]
                        file_result["forensic_warnings"] = result["forensic_warnings"]
                    else:
                        _, encoded_img = cv2.imencode(".jpg", result["output_image"])
                        base64_img = base64.b64encode(encoded_img).decode("utf-8")
                        file_result["analysis"].append({
                            "result": {
                                "total_keypoints": result["total_keypoints"],
                                "filtered_keypoints": result["filtered_keypoints"],
                                "matches": result["matches"],
                                "clusters": result["clusters"],
                                "regions": int(result["regions"]),
                                "processing_time": result["processing_time"],
                                "forensic_warnings": result["forensic_warnings"],
                                "result_image": base64_img
                            }
                        })
                elif mimetype == "application/pdf" or file_path.lower().endswith(".pdf"):
                    # Process PDF
                    file_result["type"] = "pdf"
                    doc = fitz.open(file_path)
                    for i, page in enumerate(doc):
                        base_filename = "page" + str(i + 1)
                        pix = page.get_pixmap()
                        tmp_img_path = os.path.join(temp_dir, f"{base_filename}.jpg")
                        tmp_img_path = os.path.abspath(tmp_img_path)  # 使用绝对路径
                        pix.save(tmp_img_path)
                        pix = None  # 及时释放内存

                        # 确保图片为RGB
                        try:
                            img = Image.open(tmp_img_path)
                            if img.mode == "RGBA":
                                img = img.convert("RGB")
                                img.save(tmp_img_path)
                        except Exception as e:
                            file_result.setdefault("error_pages", []).append({"page": i+1, "error": f"PIL: 图像转换失败: {str(e)}"})
                            continue
                        try:
                            image = cv2.imread(tmp_img_path, cv2.IMREAD_COLOR)
                            if image is None:
                                file_result.setdefault("error_pages", []).append({"page": i+1, "error": "无法读取图像"})
                                continue
                            # 强制转换为 BGR 格式
                            if image.shape[2] != 3:  # Check if it's not already BGR
                                image = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR) # or other appropriate conversion
                            # Process the image
                            result = process_image_no_async(
                                image_path=tmp_img_path,
                                detector_type=data.detector,
                                response_threshold=data.response_threshold,
                                matching_threshold=data.matching_threshold,
                                distance_threshold=data.distance_threshold,
                                cluster_size=data.cluster_size,
                                show_keypoints=data.show_keypoints,
                                hide_lines=data.hide_lines,
                                mask_path=mask_path,
                                use_mask=data.use_mask,
                                anti_forensics=data.anti_forensics
                            )
                            if "error" in result:
                                file_result.setdefault("error_pages", []).append({"page": i+1, "error": result["error"]})
                            else:
                                _, encoded_img = cv2.imencode(".jpg", result["output_image"])
                                base64_img = base64.b64encode(encoded_img).decode("utf-8")
                                file_result["analysis"].append({
                                    "page": i + 1,
                                    "result": {
                                        "total_keypoints": result["total_keypoints"],
                                        "filtered_keypoints": result["filtered_keypoints"],
                                        "matches": result["matches"],
                                        "clusters": result["clusters"],
                                        "regions": int(result["regions"]),
                                        "processing_time": result["processing_time"],
                                        "forensic_warnings": result["forensic_warnings"],
                                        "result_image": base64_img
                                    }
                                })
                        except Exception as e:
                            file_result.setdefault("error_pages", []).append({"page": i+1, "error": str(e)})
                        try:
                            os.remove(tmp_img_path)
                        except Exception:
                            pass
                else:
                    file_result["type"] = "unknown"
                    file_result["error"] = "不支持的文件类型"
            except Exception as e:
                file_result["error"] = str(e)

            results.append(file_result)
        is_success = True  
        await monitor.update_module_stats(
            module_name="Copy-Move Forgery",
            is_success=is_success
        )
        return {
            "results": results
        }
    except Exception as e:
        is_success = False  
        await monitor.update_module_stats(
            module_name="Copy-Move Forgery",
            is_success=is_success
        )
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            shutil.rmtree(temp_dir)
        except Exception:
            pass
        
@app.post("/echo-edge-filter", response_model=dict)
async def echo_edge_filter_api(
        data: EchoEdgeFormInput = Depends(EchoEdgeFormInput.as_form),
        monitor: ModuleMonitorService = Depends(lambda: ModuleMonitorService(app.state.pool))
        #current_user: dict = Depends(get_current_user)
):
    """API endpoint for echo edge detection, now supporting multiple files (images and PDFs)"""
    temp_dir = tempfile.mkdtemp()
    results = []
    total_files = len(data.files)

    try:
        for file_index, file in enumerate(data.files):
            filename = file.filename
            file_path = os.path.join(temp_dir, filename)

            with open(file_path, "wb") as f:
                f.write(await file.read())

            mimetype, _ = mimetypes.guess_type(file_path)

            # Initialize file_result dictionary
            file_result = {"filename": filename, "type": None, "analysis": []}

            try:
                if mimetype and mimetypes.guess_type(file_path)[0].startswith("image"):
                    # Process single image
                    file_result["type"] = "image"
                    result = process_echo_edge_no_async(
                        image_path=file_path,
                        radius=data.radius,
                        contrast=data.contrast,
                        grayscale=data.grayscale,
                        anti_forensics=data.anti_forensics
                    )

                    if "error" in result:
                        file_result["error"] = result["error"]
                    else:
                        _, encoded_img = cv2.imencode(".jpg", result["output_image"])
                        base64_img = base64.b64encode(encoded_img).decode("utf-8")

                        file_result["analysis"].append({
                            "result": {
                                "processing_time": result["processing_time"],
                                "image_size": result["image_size"],
                                "parameters": result["parameters"],
                                "forensic_warnings": result["forensic_warnings"],
                                "result_image": base64_img
                            }
                        })


                elif mimetype == "application/pdf" or file_path.lower().endswith(".pdf"):
                    # Process PDF
                    file_result["type"] = "pdf"
                    doc = fitz.open(file_path)
                    for i, page in enumerate(doc):
                        # 使用英文文件名
                        base_filename = "page" + str(i + 1)
                        pix = page.get_pixmap()
                        tmp_img_path = os.path.join(temp_dir, f"{base_filename}.jpg")
                        tmp_img_path = os.path.abspath(tmp_img_path)  # 使用绝对路径
                        pix.save(tmp_img_path)
                        pix = None  # 及时释放内存

                        # 确保图片为RGB
                        try:
                            img = Image.open(tmp_img_path)
                            if img.mode == "RGBA":
                                img = img.convert("RGB")
                                img.save(tmp_img_path)
                        except Exception as e:
                            file_result.setdefault("error_pages", []).append({"page": i+1, "error": f"PIL: 图像转换失败: {str(e)}"})
                            continue
                        try:
                            image = cv2.imread(tmp_img_path, cv2.IMREAD_COLOR)
                            if image is None:
                                file_result.setdefault("error_pages", []).append({"page": i+1, "error": "无法读取图像"})
                                continue
                            # 强制转换为 BGR 格式
                            if image.shape[2] != 3:  # Check if it's not already BGR
                                image = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR) # or other appropriate conversion

                            result = process_echo_edge_no_async(
                                image_path=tmp_img_path,
                                radius=data.radius,
                                contrast=data.contrast,
                                grayscale=data.grayscale
                            )
                            page_result = {}
                            if "error" in result:
                                file_result.setdefault("error_pages", []).append({"page": i+1, "error": result["error"]})
                            else:
                                _, encoded_img = cv2.imencode(".jpg", result["output_image"])
                                base64_img = base64.b64encode(encoded_img).decode("utf-8")
                                page_result["page"] = i + 1
                                page_result["result"] = {
                                    "processing_time": result["processing_time"],
                                    "image_size": result["image_size"],
                                    "parameters": result["parameters"],
                                    "forensic_warnings": result["forensic_warnings"],
                                    "result_image": base64_img
                                }

                                file_result["analysis"].append(page_result)
                        except Exception as e:
                            file_result.setdefault("error_pages", []).append({"page": i+1, "error": str(e)})
                        
                        try:
                            os.remove(tmp_img_path)
                        except Exception:
                            pass
                else:
                    file_result["type"] = "unknown"
                    file_result["error"] = "不支持的文件类型"
            except Exception as e:
                file_result["error"] = str(e)

            results.append(file_result)
        is_success = True  
        await monitor.update_module_stats(
            module_name="Edge Detection Filter",
            is_success=is_success
        )
        return {
            "results": results
        }

    except HTTPException:
        is_success = False  
        await monitor.update_module_stats(
            module_name="Edge Detection Filter",
            is_success=is_success
        )
        raise
    except Exception as e:
        is_success = False  
        await monitor.update_module_stats(
            module_name="Edge Detection Filter",
            is_success=is_success
        )
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        try:
            shutil.rmtree(temp_dir)
        except Exception:
            pass

@app.post("/async/detect-copy-move", response_model=Dict[str, Any])
async def detect_copy_move_api(
    background_tasks: BackgroundTasks,
    data: CopyMoveFormInput = Depends(CopyMoveFormInput.as_form)
    #current_user: User = Depends(get_current_user)
):
    """异步端点：启动复制粘贴伪造检测任务"""
    session_id = str(uuid.uuid4())
    temp_dir = tempfile.mkdtemp()
    
    # 保存上传的所有文件到临时目录
    file_contents = []
    for file in data.files:
        content = await file.read()
        file_path = os.path.join(temp_dir, file.filename)
        with open(file_path, "wb") as f:
            f.write(content)
        file_contents.append((file.filename, content))
    
    # 初始化进度状态
    progress_store[session_id] = {
        "finished": 0,
        "total": len(data.files),
        "percent": 0,
        "filename": None
    }
    result_store[session_id] = None  # 初始化为无结果
    
    # 添加后台处理任务
    background_tasks.add_task(
        async_move_process_wrapper,  # 新增的异步包装函数
        session_id,
        temp_dir,
        file_contents,
        mask=data.mask,
        detector=data.detector,
        response_threshold=data.response_threshold,
        matching_threshold=data.matching_threshold,
        distance_threshold=data.distance_threshold,
        cluster_size=data.cluster_size,
        show_keypoints=data.show_keypoints,
        hide_lines=data.hide_lines,
        use_mask=data.use_mask,
        anti_forensics=data.anti_forensics
    )
    
    return {"session_id": session_id}

def async_move_process_wrapper(session_id: str, temp_dir: str, file_contents: List[UploadFile], **kwargs):
    # 使用asyncio.create_task而不是await
    asyncio.run(
        process_detection_task(
            session_id,
            temp_dir,
            file_contents,
            **kwargs
        )
    )

async def process_detection_task(
    session_id: str,
    temp_dir: str,
    file_contents: List[UploadFile],
    mask: list,
    detector: str,
    response_threshold: float,
    matching_threshold: float,
    distance_threshold: float,
    cluster_size: int,
    show_keypoints: bool,
    hide_lines: bool,
    use_mask: bool,
    anti_forensics: bool
):
    """后台任务：执行实际检测逻辑"""
    progress_store[session_id] = {"finished": 0, "total": len(file_contents), "percent": 0, "filename": None, "error": None}
    result_store[session_id] = []
    try:
        for filename, content in file_contents:
            file_path = os.path.join(temp_dir, filename)
            print(f"Processing file {filename}...")

            try:
                with open(file_path, "wb") as f:
                    f.write(content)  # 使用预先读取的内容
            except Exception as e:
                progress_store[session_id]["error"] = f"Failed to save file {filename}: {str(e)}"
                continue
            mimetype, _ = mimetypes.guess_type(file_path)
            print(f"MIME type: {mimetype}")
            file_result = {"filename": filename, "type": None, "analysis": []}

            mask_path = None
            if mask and use_mask:
                mask_path = os.path.join(temp_dir, mask.filename)
                with open(mask_path, "wb") as f:
                    f.write(mask.file.read())

            try:
                if mimetype and mimetype.startswith("image"):
                    file_result["type"] = "image"
                    result = await process_image(
                        image_path=file_path,
                        detector_type=detector,
                        response_threshold=response_threshold,
                        matching_threshold=matching_threshold,
                        distance_threshold=distance_threshold,
                        cluster_size=cluster_size,
                        show_keypoints=show_keypoints,
                        hide_lines=hide_lines,
                        mask_path=mask_path,
                        use_mask=use_mask,
                        anti_forensics=anti_forensics
                    )
                    if "error" in result:
                        file_result["error"] = result["error"]
                    else:
                        _, encoded_img = cv2.imencode(".jpg", result["output_image"])
                        base64_img = base64.b64encode(encoded_img).decode("utf-8")
                        file_result["analysis"].append({
                            "result": {
                                "total_keypoints": result["total_keypoints"],
                                "filtered_keypoints": result["filtered_keypoints"],
                                "matches": result["matches"],
                                "clusters": result["clusters"],
                                "regions": int(result["regions"]),
                                "processing_time": result["processing_time"],
                                "anti_forensics":anti_forensics,
                                "result_image": base64_img
                            }
                        })
                elif mimetype == "application/pdf" or file_path.lower().endswith(".pdf"):
                    # Process PDF
                    file_result["type"] = "pdf"
                    doc = fitz.open(file_path)
                    for i, page in enumerate(doc):
                        base_filename = "page" + str(i + 1)
                        pix = page.get_pixmap()
                        tmp_img_path = os.path.join(temp_dir, f"{base_filename}.jpg")
                        tmp_img_path = os.path.abspath(tmp_img_path)  # 使用绝对路径
                        pix.save(tmp_img_path)
                        pix = None  # 及时释放内存

                        # 确保图片为RGB
                        try:
                            img = Image.open(tmp_img_path)
                            if img.mode == "RGBA":
                                img = img.convert("RGB")
                                img.save(tmp_img_path)
                        except Exception as e:
                            file_result.setdefault("error_pages", []).append({"page": i+1, "error": f"PIL: 图像转换失败: {str(e)}"})
                            continue
                        try:
                            image = cv2.imread(tmp_img_path, cv2.IMREAD_COLOR)
                            if image is None:
                                file_result.setdefault("error_pages", []).append({"page": i+1, "error": "无法读取图像"})
                                continue
                            # 强制转换为 BGR 格式
                            if image.shape[2] != 3:  # Check if it's not already BGR
                                image = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR) # or other appropriate conversion

                            # Process the image
                            result =await process_image(
                                image_path=tmp_img_path,
                                detector_type=detector,
                                response_threshold=response_threshold,
                                matching_threshold=matching_threshold,
                                distance_threshold=distance_threshold,
                                cluster_size=cluster_size,
                                show_keypoints=show_keypoints,
                                hide_lines=hide_lines,
                                mask_path=mask_path,
                                use_mask=use_mask,
                                anti_forensics=anti_forensics
                            )
                            if "error" in result:
                                file_result.setdefault("error_pages", []).append({"page": i+1, "error": result["error"]})
                            else:
                                _, encoded_img = cv2.imencode(".jpg", result["output_image"])
                                base64_img = base64.b64encode(encoded_img).decode("utf-8")
                                file_result["analysis"].append({
                                    "page": i + 1,
                                    "result": {
                                        "total_keypoints": result["total_keypoints"],
                                        "filtered_keypoints": result["filtered_keypoints"],
                                        "matches": result["matches"],
                                        "clusters": result["clusters"],
                                        "regions": int(result["regions"]),
                                        "processing_time": result["processing_time"],
                                        "anti_forensics":anti_forensics,
                                        "result_image": base64_img
                                    }
                                })
                        except Exception as e:
                            file_result.setdefault("error_pages", []).append({"page": i+1, "error": str(e)})
                        try:
                            image = None  # 释放OpenCV对象
                            if 'img' in locals():
                                img.close()  # 关闭PIL对象
                            os.remove(tmp_img_path)
                        except Exception:
                            pass
                    doc.close()  # 确保文档被关闭
                    try:
                        os.remove(file_path)
                    except Exception:
                        pass
                else:
                    file_result["type"] = "unknown"
                    file_result["error"] = "不支持的文件类型"
            except Exception as e:
                file_result["error"] = str(e)

            result_store[session_id].append(file_result)
             # Update progress after each file is processed
            progress_store[session_id]["finished"] += 1
            progress_store[session_id]["percent"] = int((progress_store[session_id]["finished"] / progress_store[session_id]["total"]) * 100)
            progress_store[session_id]["filename"] = filename
             # 添加日志记录
            print(f"Task progress: {progress_store[session_id]}")
    except Exception as e:
        progress_store[session_id]["error"] = str(e)
        print(f"Task error: {str(e)}")
    finally:
        shutil.rmtree(temp_dir)

@app.post("/async/echo-edge-filter", response_model=dict)
async def echo_edge_filter_api(
    background_tasks: BackgroundTasks,
    data: EchoEdgeFormInput = Depends(EchoEdgeFormInput.as_form)
):
    """异步处理端点：启动后台任务并立即返回会话ID"""
    session_id = str(uuid.uuid4())
    temp_dir = tempfile.mkdtemp()
    
    # 保存原始文件到临时目录
    file_contents = []
    for file in data.files:
        content = await file.read()
        file_path = os.path.join(temp_dir, file.filename)
        with open(file_path, "wb") as f:
            f.write(content)
        file_contents.append((file.filename, content))
    
    # 初始化进度状态
    progress_store[session_id] = {
        "finished": 0,
        "total": len(data.files),
        "percent": 0,
        "filename": None
    }
    result_store[session_id] = None  # 初始化为无结果
    
    # 添加后台处理任务
    background_tasks.add_task(
        async_filter_process_wrapper,
        session_id,
        temp_dir,
        file_contents,  # 传递已保存的文件内容
        radius=data.radius,
        contrast=data.contrast,
        grayscale=data.grayscale,
        anti_forensics=data.anti_forensics
    )
    
    return {"session_id": session_id}

def async_filter_process_wrapper(session_id: str, temp_dir: str, file_contents: List[UploadFile], **kwargs):
    # 使用asyncio.create_task而不是await
    asyncio.run(
        process_files_task(
            session_id,
            temp_dir,
            file_contents,
            **kwargs
        )
    )

async def process_files_task(
    session_id: str,
    temp_dir: str,
    file_contents: List[UploadFile],
    radius: float,
    contrast: float,
    grayscale: bool,
    anti_forensics: bool
):
    """后台任务函数：实际的文件处理逻辑"""
    progress_store[session_id] = {"finished": 0, "total": len(file_contents), "percent": 0, "filename": None, "error": None}
    result_store[session_id] = []
    try:
        for filename, content in file_contents:
            file_path = os.path.join(temp_dir, filename)
            try:
                with open(file_path, "wb") as f:
                    f.write(content)  # 使用预先读取的内容
            except Exception as e:
                progress_store[session_id]["error"] = f"Failed to save file {filename}: {str(e)}"
                continue
            mimetype, _ = mimetypes.guess_type(file_path)
            print(f"MIME type: {mimetype}")
            file_result = {"filename": filename, "type": None, "analysis": []}
            try:
                if mimetype and mimetypes.guess_type(file_path)[0].startswith("image"):
                    # Process single image
                    file_result["type"] = "image"
                    result =await process_echo_edge(
                        image_path=file_path,
                        radius=radius,
                        contrast=contrast,
                        grayscale=grayscale,
                        anti_forensics=anti_forensics
                    )

                    if "error" in result:
                        file_result["error"] = result["error"]
                    else:
                        _, encoded_img = cv2.imencode(".jpg", result["output_image"])
                        base64_img = base64.b64encode(encoded_img).decode("utf-8")

                        file_result["analysis"].append({
                            "result": {
                                "processing_time": result["processing_time"],
                                "image_size": result["image_size"],
                                "parameters": result["parameters"],
                                "forensic_warnings": result["forensic_warnings"],
                                "result_image": base64_img
                            }
                        })

                elif mimetype == "application/pdf" or file_path.lower().endswith(".pdf"):
                    # Process PDF
                    file_result["type"] = "pdf"
                    doc = fitz.open(file_path)
                    for i, page in enumerate(doc):
                        # 使用英文文件名
                        base_filename = "page" + str(i + 1)
                        pix = page.get_pixmap()
                        tmp_img_path = os.path.join(temp_dir, f"{base_filename}.jpg")
                        tmp_img_path = os.path.abspath(tmp_img_path)  # 使用绝对路径
                        pix.save(tmp_img_path)
                        pix = None  # 及时释放内存

                        # 确保图片为RGB
                        try:
                            img = Image.open(tmp_img_path)
                            if img.mode == "RGBA":
                                img = img.convert("RGB")
                                img.save(tmp_img_path)
                        except Exception as e:
                            file_result.setdefault("error_pages", []).append({"page": i+1, "error": f"PIL: 图像转换失败: {str(e)}"})
                            continue
                        try:
                            image = cv2.imread(tmp_img_path, cv2.IMREAD_COLOR)
                            if image is None:
                                file_result.setdefault("error_pages", []).append({"page": i+1, "error": "无法读取图像"})
                                continue
                            # 强制转换为 BGR 格式
                            if image.shape[2] != 3:  # Check if it's not already BGR
                                image = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR) # or other appropriate conversion

                            result = await process_echo_edge(
                                image_path=tmp_img_path,
                                radius=radius,
                                contrast=contrast,
                                grayscale=grayscale,
                                anti_forensics=anti_forensics
                            )
                            page_result = {}
                            if "error" in result:
                                file_result.setdefault("error_pages", []).append({"page": i+1, "error": result["error"]})
                            else:
                                _, encoded_img = cv2.imencode(".jpg", result["output_image"])
                                base64_img = base64.b64encode(encoded_img).decode("utf-8")
                                page_result["page"] = i + 1
                                page_result["result"] = {
                                    "processing_time": result["processing_time"],
                                    "image_size": result["image_size"],
                                    "parameters": result["parameters"],
                                    "forensic_warnings": result["forensic_warnings"],
                                    "result_image": base64_img
                                }

                                file_result["analysis"].append(page_result)
                        except Exception as e:
                            file_result.setdefault("error_pages", []).append({"page": i+1, "error": str(e)})
                        try:
                            image = None  # 释放OpenCV对象
                            if 'img' in locals():
                                img.close()  # 关闭PIL对象
                            os.remove(tmp_img_path)
                        except Exception:
                            pass
                    doc.close()  # 确保文档被关闭
                    try:
                        os.remove(file_path)
                    except Exception:
                        pass
                else:
                    file_result["type"] = "unknown"
                    file_result["error"] = "不支持的文件类型"
            except Exception as e:
                file_result["error"] = str(e)

            result_store[session_id].append(file_result)
            progress_store[session_id]["finished"] += 1
            progress_store[session_id]["percent"] = int((progress_store[session_id]["finished"] / progress_store[session_id]["total"]) * 100)
            progress_store[session_id]["filename"] = filename

            # 添加日志记录
            print(f"Task progress: {progress_store[session_id]}")
    except Exception as e:
        progress_store[session_id]["error"] = str(e)
        print(f"Task error: {str(e)}")
    finally:
        shutil.rmtree(temp_dir)
        
@app.post("/errorlevel", response_model=ElaResponse)
async def perform_ela(
        request: ElaRequest = Depends(ElaRequest.as_form),
        monitor: ModuleMonitorService = Depends(lambda: ModuleMonitorService(app.state.pool))
#current_user: dict = Depends(get_current_user)
) :
    temp_dir = tempfile.mkdtemp()
    results = []

    try:
        for file_index, file in enumerate(request.files):
            filename = file.filename
            file_path = os.path.join(temp_dir, filename)
            with open(file_path, "wb") as f:
                f.write(await file.read())

            mimetype, _ = mimetypes.guess_type(file_path)
            # Initialize file_result dictionary
            file_result = {"filename": filename, "type": None, "analysis": []}

            try:
                if mimetype and mimetype.startswith("image"):
                    # Process single image
                    file_result["type"] = "image"

                    analysis_result = apply_ela_processing_no_async(
                        image_path=file_path,
                        quality=request.quality,
                        scale=request.scale,
                        contrast=request.contrast,
                        linear=request.linear,
                        grayscale=request.grayscale
                    )

                    if "error" in analysis_result:
                        file_result["error"] = analysis_result["error"]
                    else:
                        # _, encoded_img = cv2.imencode(".jpg", result["output_image"]) # Incorrect
                        # base64_img = base64.b64encode(encoded_img).decode("utf-8")

                        file_result["analysis"] = analysis_result # Store the analysis result

                elif mimetype == "application/pdf" or file_path.lower().endswith(".pdf"):
                    # Process PDF
                    file_result["type"] = "pdf"
                    doc = fitz.open(file_path)
                    pdf_analysis = [] # Store analysis for each page
                    for i, page in enumerate(doc):
                        # 使用英文文件名
                        base_filename = "page" + str(i + 1)
                        pix = page.get_pixmap()
                        tmp_img_path = os.path.join(temp_dir, f"{base_filename}.jpg")
                        tmp_img_path = os.path.abspath(tmp_img_path)  # 使用绝对路径
                        pix.save(tmp_img_path)
                        pix = None  # 及时释放内存

                        # 确保图片为RGB
                        try:
                            img = Image.open(tmp_img_path)
                            if img.mode == "RGBA":
                                img = img.convert("RGB")
                                img.save(tmp_img_path)
                            # 验证 PIL 是否成功转换图像
                            img = Image.open(tmp_img_path)
                            print(f"PIL: Image size after conversion: {img.size}")
                        except Exception as e:
                            pdf_analysis.append({"page": i+1, "error": f"PIL: 图像转换失败: {str(e)}"})
                            continue

                        try:
                            image = cv2.imread(tmp_img_path, cv2.IMREAD_COLOR)
                            if image is None:
                                pdf_analysis.append({"page": i+1, "error": "无法读取图像"})
                                continue
                            # 强制转换为 BGR 格式
                            if image.shape[2] != 3:  # Check if it's not already BGR
                                image = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR) # or other appropriate conversion
                            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) # Now it should work

                            result = apply_ela_processing_no_async(
                                image_path=tmp_img_path,
                                quality=request.quality,
                                scale=request.scale,
                                contrast=request.contrast,
                                linear=request.linear,
                                grayscale=request.grayscale
                            )

                            if "error" in result:
                                pdf_analysis.append({"page": i+1, "error": result["error"]})
                            else:
                                pdf_analysis.append({"page": i + 1, "analysis": result})

                        except Exception as e:
                            pdf_analysis.append({"page": i+1, "error": str(e)})
                        try:
                            os.remove(tmp_img_path)
                        except Exception:
                            pass
                    file_result["analysis"] = pdf_analysis # Store PDF analysis results

                else:
                    file_result["type"] = "unknown"
                    file_result["error"] = "不支持的文件类型"
            except Exception as e:
                file_result["error"] = str(e)
                
            results.append(file_result)
        # 在同一个事务中执行监控和文档存储
        async with monitor.pool.acquire() as conn:
            async with conn.transaction():
                # 保存分析结果
                await monitor.save_analysis_results(
                    #user_id=current_user["id"],
                    user_id=1,
                    files=results,
                    module_name="Error Level Analysis",
                    conn=conn
                )
                
                # 更新模块统计（使用同一个连接）
                await monitor.update_module_stats(
                    module_name="Error Level Analysis",
                    is_success=True,
                    conn=conn
                )
        return ElaResponse(results=results)

    except HTTPException as e:
        raise e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        try:
            shutil.rmtree(temp_dir)
        except OSError:
            pass  # Handle potential directory removal errors

@app.post("/async/errorlevel", response_model=dict)
async def perform_ela(
    background_tasks: BackgroundTasks,
    request: ElaRequest = Depends(ElaRequest.as_form)
):
    session_id = str(uuid.uuid4())
    print(f"Starting task with session_id: {session_id}")
    # 先读取所有文件内容到内存
    file_contents = []
    for file in request.files:
        content = await file.read()
        file_contents.append((file.filename, content))
    
    background_tasks.add_task(
        async_error_process_wrapper,  # 新增的异步包装函数
        session_id,
        file_contents,  # 传递已读取的文件内容
        apply_ela_processing,
        quality=request.quality,
        scale=request.scale,
        contrast=request.contrast,
        linear=request.linear,
        grayscale=request.grayscale
    )
    return {"session_id": session_id}

def async_error_process_wrapper(session_id: str, file_contents: List[UploadFile], processing_function, **kwargs):
    # 使用asyncio.create_task而不是await
    asyncio.run(
        process_task(
            session_id,
            file_contents,
            processing_function,
            **kwargs
        )
    )
def cleanup_expired_progress():
    """清理过期进度记录"""
    with progress_lock:
        now = datetime.now()
        expired_keys = [
            k for k, v in progress_store.items()
            if now - v["created_at"] > timedelta(hours=PROGRESS_EXPIRE_HOURS)
        ]
        for k in expired_keys:
            del progress_store[k]
        print("Cleaned up expired progress entries.")
def run_cleanup_task():
    """Runs the cleanup task in a loop."""
    while True:
        cleanup_expired_progress()
        time.sleep(3600)  # Sleep for 1 hour

# Start the cleanup thread
cleanup_thread = threading.Thread(target=run_cleanup_task)
cleanup_thread.daemon = True  # Daemonize thread so it exits when the app exits
cleanup_thread.start()


async def process_task(session_id: str, file_contents: List[UploadFile], processing_function, **kwargs):
    """
    异步处理任务，将文件保存和处理逻辑放入后台任务中。
    """
    temp_dir = tempfile.mkdtemp()
    progress_store[session_id] = {"finished": 0, "total": len(file_contents), "percent": 0, "filename": None, "error": None}
    result_store[session_id] = []

    try:
        for filename, content in file_contents:
            file_path = os.path.join(temp_dir, filename)
            print(f"Processing file {filename}...")

            try:
                with open(file_path, "wb") as f:
                    f.write(content)  # 使用预先读取的内容
            except Exception as e:
                progress_store[session_id]["error"] = f"Failed to save file {filename}: {str(e)}"
                continue

            mimetype, _ = mimetypes.guess_type(file_path)
            print(f"MIME type: {mimetype}")
            file_result = {"filename": filename, "type": None, "analysis": []}

            try:
                if mimetype and mimetype.startswith("image"):
                    file_result["type"] = "image"
                    # 只传文件路径 + 关键字参数
                    result = await processing_function(file_path, **kwargs)
                    file_result["analysis"].append(result)
                    
                elif mimetype == "application/pdf" or file_path.lower().endswith(".pdf"):
                    # PDF文件处理
                    file_result["type"] = "pdf"
                    doc = fitz.open(file_path)
                    for i, page in enumerate(doc):
                        # 使用英文文件名
                        base_filename = "page" + str(i + 1)
                        pix = page.get_pixmap()
                        tmp_img_path = os.path.join(temp_dir, f"{base_filename}.jpg")
                        tmp_img_path = os.path.abspath(tmp_img_path)  # 使用绝对路径
                        pix.save(tmp_img_path)
                        pix = None  # 及时释放内存

                        result = await processing_function(tmp_img_path, **kwargs)  # 只传路径+参数
                        file_result["analysis"].append(result)  # 追加结果
                        try:
                            os.remove(tmp_img_path)
                        except Exception:
                            pass
                    doc.close()  # 确保文档被关闭
                    try:
                        os.remove(file_path)
                    except Exception:
                        pass
                else:
                    file_result["type"] = "unknown"
                    file_result["error"] = "Unsupported file type"
            except Exception as e:
                file_result["error"] = str(e)

            result_store[session_id].append(file_result)
            progress_store[session_id]["finished"] += 1
            progress_store[session_id]["percent"] = int((progress_store[session_id]["finished"] / progress_store[session_id]["total"]) * 100)
            progress_store[session_id]["filename"] = filename

            # 添加日志记录
            print(f"Task progress: {progress_store[session_id]}")
    except Exception as e:
        progress_store[session_id]["error"] = str(e)
        print(f"Task error: {str(e)}")
    finally:
        shutil.rmtree(temp_dir)

@app.get("/progress/{session_id}")
def get_progress_api(session_id: str) -> Dict[str, Any]:
    """
    查询指定会话ID的分析进度。
    """
    progress = progress_store.get(session_id)
    if not progress:
        return {"finished": 0, "total": 0, "percent": 0, "filename": None}
    return progress

@app.get("/results/{session_id}")
def get_results_api(session_id: str) -> List[Dict[str, Any]]:
    """
    查询指定会话ID的分析结果。
    """
    results = result_store.get(session_id)
    if not results:
        raise HTTPException(status_code=404, detail="No results found for the given session ID")
    return results


@app.post("/combined-analysis", response_model=CombinedResult)
async def combined_analysis(
    files: List[UploadFile] = File(...),
    data: CombineInput = Depends(CombineInput.as_form),
    monitor: ModuleMonitorService = Depends(lambda: ModuleMonitorService(app.state.pool))
):
    """
    合并 PCA 分析和图像统计分析的接口。
    逻辑：先执行 PCA 分析，再执行图像统计分析。
    """
    # 初始化结果存储
    errors = []
    temp_dir = tempfile.mkdtemp()
    pca_results = []
    stats_result = []  # 修改为 stats_result
    detections = []
    echo_results = []
    total_alerts = 0
    alertered_filename= []
    alertered_summary= {}
    exif_results = []
    thresholds_used = MODE_THRESHOLDS_  # Include all modes
    alert_images = []  # 初始化为列表
    modes = ["minimum", "average", "maximum"]
    alert_pages_total = 0

    extra_messages = []
    total_alerts_fraud = 0 

    results = []  # 新增：用于构建 save_analysis_results 需要的 files 参数

    try:
        for i, file in enumerate(files):
            filename = file.filename
            safe_filename = Path(filename).name
            file_path = os.path.join(temp_dir, filename)
            print(f"Processing file {filename}...")
            # 保存文件
            with open(file_path, "wb") as f:
                f.write(await file.read())

            alert_message_pca = []
            alert_message_pixel = []
            alert_message_metedata = []
            alert_message_ai = []

            # 执行合并分析
            try:
                stats_result_per_file, pca_result_per_file, alert_pages_per_file, _, detection_per_file, echo_result_per_file,exif_result_per_file= cal_combined_analysis_no_async(
                    filepath=file_path,
                    filename=safe_filename,
                    data=data,
                    modes=modes,
                    save_alert_images=True,
                    save_dir=temp_dir
                )
                alert_pages_total += alert_pages_per_file
                    
                if alert_pages_per_file > 0:
                    alert_images.append(filename)
                    
                stats_result.append(CombinFileAnalysisResult(
                    filename=safe_filename,
                    stats=stats_result_per_file
                ))

                for stats_result_per in stats_result_per_file:
                    if stats_result_per["filename"] not in alertered_filename:
                        total_alerts += stats_result_per["alert"]
                        alertered_filename.append(stats_result_per["filename"])
                    if stats_result_per["filename"] not in alertered_summary:
                        alertered_summary[stats_result_per["filename"]] = []
                    for alert in stats_result_per["alerts"]:
                        for msg in alert["message"]:
                            if msg not in alert_message_pixel:
                                alert_message_pixel.append(msg)
                            if msg not in alertered_summary[stats_result_per["filename"]]:
                                alertered_summary[stats_result_per["filename"]].append(msg)
                for detection in detection_per_file:
                    if detection["result"] == "AI":
                        if detection["filename"] not in alertered_filename:
                            total_alerts += 1
                            alertered_filename.append(detection["filename"])
                        if detection["filename"] not in alertered_summary:
                            alertered_summary[detection["filename"]] = [] 
                        if detection["alert_message"] not in alertered_summary[detection["filename"]]:
                            alertered_summary[detection["filename"]].append(detection["alert_message"])
                        alert_message_ai.append(detection["alert_message"])
                for pca_result in pca_result_per_file:
                    if pca_result.filename not in alertered_filename:
                        total_alerts += pca_result.alert
                        alertered_filename.append(pca_result.filename)
                    if pca_result.filename not in alertered_summary:
                            alertered_summary[pca_result.filename] = []
                    for alert_message in pca_result.alert_message:
                        if alert_message not in alertered_summary[pca_result.filename]:
                            alertered_summary[pca_result.filename].append(alert_message)
                        if alert_message not in alert_message_pca:
                            alert_message_pca.append(alert_message)


                detections.append(detection_per_file)
                pca_results.append(pca_result_per_file)
                exif_results.append(exif_result_per_file)
                count = 0
                for echo_result in echo_result_per_file:
                    _filename = os.path.splitext(filename)[0] + "_page_" + str(count + 1)
                    echo_results.append(CombinEchoResult(
                        filename=_filename,
                        processing_time=echo_result["processing_time"],
                        image_size=echo_result["image_size"],
                        parameters=echo_result["parameters"],
                        forensic_warnings=echo_result["forensic_warnings"]
                        #result_image=base64_img
                    ))
                    count += 1
                    if echo_result["forensic_warnings"] is not None and len(echo_result["forensic_warnings"]) > 0:
                        if _filename not in alertered_filename:
                            alertered_filename.append(_filename)
                        if _filename not in alertered_summary:
                                alertered_summary[_filename] = []
                        for warning in echo_result["forensic_warnings"]:
                            if warning not in alertered_summary[_filename]:
                                alertered_summary[_filename].append(warning)
                for exif_result in exif_result_per_file:
                    if exif_result["filename"] not in alertered_filename:
                        alertered_filename.append(exif_result["filename"])
                    if exif_result["filename"] not in alertered_summary:
                        alertered_summary[exif_result["filename"]] = []
                    for alert_message in exif_result["alert_message"]:
                        alertered_summary[exif_result["filename"]].append(alert_message)
                        alert_message_metedata.append(alert_message)
                
                # 初始化结果字典
                extra_message = {
                    "potential_fraud": "no",
                    "metedata_test": "pass",
                    "pixel_test": "pass",
                    "pca_test": "pass",
                    "ai_test": "pass",
                    "filename": safe_filename
                }

                # 元数据测试
                if len(alert_message_metedata) >= 1:
                    extra_message["metedata_test"] = "fail"
                    extra_message["alert_message_metedata"] = alert_message_metedata

                # Pixel测试
                if len(alert_message_pixel) >= 3:
                    extra_message["pixel_test"] = "fail"
                    extra_message["alert_message_pixel"] = alert_message_pixel

                # PCA测试
                if len(alert_message_pca) >= 2:
                    extra_message["pca_test"] = "fail"
                    extra_message["alert_message_pca"] = alert_message_pca

                # AI测试
                if len(alert_message_ai) >= 1:
                    extra_message["ai_test"] = "fail"
                    extra_message["alert_message_ai"] = alert_message_ai
                
                # Extra Fraud Detection Logic
                pixel_failed = extra_message["pixel_test"] == "fail"
                pca_failed = extra_message["pca_test"] == "fail"

                # Potential Fraud message
                if pixel_failed and pca_failed:
                    extra_message["potential_fraud"] = "yes"
                elif any(extra_message[test] == "fail" for test in ["metedata_test", "ai_test"]):
                    extra_message["potential_fraud"] = "yes"
                elif pixel_failed or pca_failed:
                    extra_message["potential_fraud"] = "Require Additional Investigation"
                # Alert count
                if extra_message["potential_fraud"] == "yes" or extra_message["potential_fraud"] == "Require Additional Investigation":
                    total_alerts_fraud += 1
                extra_messages.append(extra_message)
                '''
                # 欺诈检测
                if any(test == "fail" for test in [
                    extra_message.get("metedata_test", "pass"),
                    extra_message.get("pixel_test", "pass"),
                    extra_message.get("pca_test", "pass"),
                    extra_message.get("ai_test", "pass")
                ]):
                    extra_message["potential_fraud"] = "yes"
                    total_alerts_fraud += 1
                extra_messages.append(extra_message)
                '''

                # ===== 在文件处理完成后，构建 results 元素 =====
                file_result = {
                    "filename": safe_filename,
                    "filepath": file_path,
                    "filesize": os.path.getsize(file_path),
                    "type": file.content_type,
                    "pages": []
                }

                # 添加页面级结果（每页一个字典）
                for page_idx, (pca_page, stats_page, detection_page, echo_page) in enumerate(zip(
                    pca_result_per_file,
                    stats_result_per_file,  # 注意：确保长度一致
                    detection_per_file,
                    echo_result_per_file
                )):
                    page_result = {
                        "page": page_idx + 1,
                        "text_content": "",  # 可添加实际文本内容
                        "analysis": {
                            "pca": {
                                "alert": pca_page.alert if hasattr(pca_page, 'alert') else 0,
                                "pca_components": getattr(pca_page, 'pca_components', None),
                                "cluster_analysis": getattr(pca_page, 'cluster_analysis', None)
                            },
                            "stats": {
                                "alerts": stats_page.get("alerts", []),
                                "intensity": stats_page.get("intensity", {})
                            },
                            "detection": {
                                "model": detection_page.get("model"),
                                "confidence": detection_page.get("confidence"),
                                "result": detection_page.get("result")
                            },
                            "echo": echo_page.forensic_warnings if hasattr(echo_page, 'forensic_warnings') else None
                        },
                        "detection_status": "processed"  # 可改为实际状态
                    }
                    file_result["pages"].append(page_result)

                # 添加文件级元数据和额外信息
                file_result["extra"] = {
                    "component": data.component,
                    "module_name": "Pixel & AI Analysis",
                    "alert_summary": alertered_summary.get(safe_filename, []),
                    "is_potential_fraud": extra_message["potential_fraud"]
                }
                
                results.append(file_result)  # 添加到最终结果
                # ===== results 构建结束 =====


            except Exception as e:
                error_message = f"Error in file {i+1} ({file.filename}): {str(e)}"
                print(error_message)
                errors.append(error_message)
                continue

        async with monitor.pool.acquire() as conn:
            async with conn.transaction():
                # 保存分析结果
                await monitor.save_analysis_results(
                    #user_id=current_user["id"],
                    user_id=1,
                    files=results,
                    module_name="Piexl & AI Analysis",
                    conn=conn
                )
                
                # 更新模块统计（使用同一个连接）
                await monitor.update_module_stats(
                    module_name="Piexl & AI Analysis",
                    is_success=True,
                    conn=conn
                )
        return CombinedResult(
            alertered_filename=alert_images,
            alertered_summary=alertered_summary,
            total_alerts=total_alerts,
            pca_results=pca_results,
            stats_results=stats_result,
            detections =detections,
            echo_results=echo_results,
            component=data.component,
            mode=data.mode,
            invert=data.invert,
            equalize=data.equalize,
            alert_images=alert_images,
            thresholds_used=thresholds_used,
            extra_messages=extra_messages,
            total_alerts_fraud=total_alerts_fraud
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        shutil.rmtree(temp_dir)

@app.post("/async/combined-analysis", response_model=dict)
async def combined_analysis(
    background_tasks: BackgroundTasks,
    data: CombineInput = Depends(CombineInput.as_form)
):
    session_id = str(uuid.uuid4())
     # 先读取所有文件内容到内存
    file_contents = []
    for file in data.files:
        content = await file.read()
        file_contents.append((file.filename, content))

    background_tasks.add_task(
        async_process_wrapper,  # 新增的异步包装函数
        session_id,
        file_contents,  # 直接传递文件对象
        cal_combined_analysis,
        data=data
    )
    return {"session_id": session_id}

def async_process_wrapper(session_id: str, file_contents: List[UploadFile], processing_function, **kwargs):
    # 使用asyncio.create_task而不是await
    asyncio.run(
        combine_process_task(
            session_id,
            file_contents,
            processing_function,
            **kwargs
        )
    )

async def combine_process_task(session_id: str, file_contents: List[UploadFile], processing_function, **kwargs):
    """
    异步处理任务，将文件保存和处理逻辑放入后台任务中。
    """
    temp_dir = tempfile.mkdtemp()
    progress_store[session_id] = {"finished": 0, "total": len(file_contents), "percent": 0, "filename": None, "error": None}
    result_store[session_id] = []

    errors = []
    pca_results = []
    stats_result = []  # 修改为 stats_result
    detections = []
    echo_results = []
    total_alerts = 0
    alertered_filename= []
    alertered_summary= {}
    thresholds_used = MODE_THRESHOLDS_  # Include all modes
    alert_images = []  # 初始化为列表
    modes = ["minimum", "average", "maximum"]
    alert_pages_total = 0
    file_result = {"analysis": []}
    try:
        for filename, content in file_contents:
            file_path = os.path.join(temp_dir, filename)
            safe_filename = Path(filename).name
            print(f"Processing file {filename}...")
           
            try:
                with open(file_path, "wb") as f:
                    f.write(content)  # 使用预先读取的内容
            except Exception as e:
                progress_store[session_id]["error"] = f"Failed to save file {filename}: {str(e)}"
                continue

            # 执行合并分析
            try:
                result_tuple = await processing_function(
                    filepath=file_path,
                    filename=safe_filename,
                    data=kwargs["data"],
                    modes=modes,
                    save_alert_images=True,
                    save_dir=temp_dir
                )
                stats_result_per_file, pca_result_per_file, alert_pages_per_file, _, detection_per_file, echo_result_per_file = result_tuple

                alert_pages_total += alert_pages_per_file
                    
                if alert_pages_per_file > 0:
                    alert_images.append(filename)
                    
                stats_result.append(CombinFileAnalysisResult(
                    filename=safe_filename,
                    stats=stats_result_per_file
                ))

                for stats_result_per in stats_result_per_file:
                    if stats_result_per["filename"] not in alertered_filename:
                        total_alerts += stats_result_per["alert"]
                        alertered_filename.append(stats_result_per["filename"])
                    if stats_result_per["filename"] not in alertered_summary:
                        alertered_summary[stats_result_per["filename"]] = []
                    for alert in stats_result_per["alerts"]:
                        for msg in alert["message"]:
                            if msg not in alertered_summary[stats_result_per["filename"]]:
                                alertered_summary[stats_result_per["filename"]].append(msg)
                for detection in detection_per_file:
                    if detection["result"] == "AI":
                        if detection["filename"] not in alertered_filename:
                            total_alerts += 1
                            alertered_filename.append(detection["filename"])
                        if detection["filename"] not in alertered_summary:
                            alertered_summary[detection["filename"]] = [] 
                        if detection["alert_message"] not in alertered_summary[detection["filename"]]:
                            alertered_summary[detection["filename"]].append(detection["alert_message"])
                for pca_result in pca_result_per_file:
                    if pca_result.filename not in alertered_filename:
                        total_alerts += pca_result.alert
                        alertered_filename.append(pca_result.filename)
                    if pca_result.filename not in alertered_summary:
                            alertered_summary[pca_result.filename] = []
                    for alert_message in pca_result.alert_message:
                        if alert_message not in alertered_summary[pca_result.filename]:
                            alertered_summary[pca_result.filename].append(alert_message)

                detections.append(detection_per_file)
                pca_results.append(pca_result_per_file)

                echo_result_per_file
                count = 0
                for echo_result in echo_result_per_file:
                    _filename = os.path.splitext(filename)[0] + "_page_" + str(count + 1)
                    echo_results.append(CombinEchoResult(
                        filename=_filename,
                        processing_time=echo_result["processing_time"],
                        image_size=echo_result["image_size"],
                        parameters=echo_result["parameters"],
                        forensic_warnings=echo_result["forensic_warnings"]
                        #result_image=base64_img
                    ))
                    count += 1
                    if echo_result["forensic_warnings"] is not None and len(echo_result["forensic_warnings"]) > 0:
                        if _filename not in alertered_filename:
                            alertered_filename.append(_filename)
                        if _filename not in alertered_summary:
                                alertered_summary[_filename] = []
                        for warning in echo_result["forensic_warnings"]:
                            if warning not in alertered_summary[_filename]:
                                alertered_summary[_filename].append(warning)
            except Exception as e:
                error_message = f"Error in file ({filename}): {str(e)}"
                print(error_message)
                errors.append(error_message)
                continue
            
            result_store[session_id].append(file_result)
            progress_store[session_id]["finished"] += 1
            progress_store[session_id]["percent"] = int((progress_store[session_id]["finished"] / progress_store[session_id]["total"]) * 100)
            progress_store[session_id]["filename"] = filename
            
        file_result["analysis"].append(CombinedResult(
            alertered_filename=alert_images,
            alertered_summary=alertered_summary,
            total_alerts=len(alert_images),
            pca_results=pca_results,
            stats_results=stats_result,
            detections =detections,
            echo_results=echo_results,
            component=kwargs.get('data').component,  # 从kwargs中获取data的属性
            mode=kwargs.get('data').mode,
            invert=kwargs.get('data').invert,
            equalize=kwargs.get('data').equalize,
            alert_images=alert_images,
            thresholds_used=thresholds_used
        ))


        # 添加日志记录
        print(f"Task progress: {progress_store[session_id]}")
    except Exception as e:
        progress_store[session_id]["error"] = str(e)
        print(f"Task error: {str(e)}")
    finally:
        shutil.rmtree(temp_dir)


################################### 新增的异步查询接口 ######################################

# 进度存储结构
async_progress_store = {}

@app.post("/async-combined-analysis", response_model=Dict[str, Any])
async def async_combined_analysis(
    data: CombineInput = Depends(CombineInput.as_form),
    #current_user: User = Depends(get_current_user),
    monitor: ModuleMonitorService = Depends(lambda: ModuleMonitorService(app.state.pool))
):
    """异步组合分析接口 - 增强版(支持完整分析参数)"""
    # 生成唯一任务ID
    task_id = str(uuid.uuid4())

    # 关键修改1: 在请求上下文中读取并缓存文件内容
    file_contents = []
    for file in data.files:
        content = await file.read()  # 在请求结束前读取内容
        file_contents.append({
            "filename": file.filename,
            "content": content,
            "content_type": file.content_type
        })
    
    # 提取关键参数
    params_dict = {
        "component": data.component,
        "mode": data.mode,
        "invert": data.invert,
        "equalize": data.equalize,
        "inclusive": data.inclusive,
        "radius": data.radius,
        "contrast": data.contrast,
        "grayscale": data.grayscale,
        "anti_forensics": data.anti_forensics
    }
    
    # 初始化进度存储
    async_progress_store[task_id] = {
        "status": "processing",
        "total_files": len(data.files),
        "processed_files": 0,
        "current_file": None,
        "parameters": params_dict,
        "batch_id": None,
        "job_id": None,
        "errors": []
    }
    
    # 在后台运行分析任务（传递所有分析参数）
    asyncio.create_task(
        #run_enhanced_analysis(task_id, data.files, current_user, monitor, params_dict)
        run_enhanced_analysis(task_id, file_contents, monitor, params_dict)
    )
    
    return {"task_id": task_id, "status": "processing"}

async def run_enhanced_analysis(
    task_id: str,
    file_contents: List[dict],  # 修改参数类型
    #current_user: User,
    monitor: ModuleMonitorService,
    parameters: dict
):
    """增强版分析任务处理"""
    async with monitor.pool.acquire() as conn:
        async with conn.transaction():
            try:
                # 创建批次（记录分析参数）
                batch_name = (
                    f"CombinedAnalysis-{parameters['mode']}-"
                    f"{'EQL' if parameters['equalize'] else 'RAW'}-"
                    f"{datetime.utcnow().strftime('%m%d%H%M')}"
                )
                
                batch_id = await monitor.create_batch(
                    #user_id=current_user.id,
                    user_id=1,
                    batch_name="Pixel & AI Analysis",
                    conn=conn
                )
                if not batch_id:
                    raise Exception("批次创建失败")
                
                # 创建作业（存储参数快照）
                job_id = await monitor.create_job(
                    batch_id=batch_id,
                    conn=conn
                )
                
                # 更新进度
                async_progress_store[task_id].update({
                    "batch_id": batch_id,
                    "job_id": job_id
                })
                alert_images = []  # 初始化为列表
                stats_result = []
                pca_results = []
                detections = []
                echo_results = []
                total_alerts = 0
                alertered_filename= []
                alertered_summary= {}
                exif_results = []
                results = []
                temp_dir = tempfile.mkdtemp()
                alert_pages_total = 0
                # 处理每个文件
                for idx, file_info in enumerate(file_contents):
                    file_name = file_info["filename"]
                    content = file_info["content"]
                    content_type = file_info["content_type"]
                    alert_message_pca = []
                    alert_message_pixel = []
                    alert_message_metedata = []
                    alert_message_ai = []
                    async_progress_store[task_id].update({
                        "current_file": file_name,
                        "processed_files": idx
                    })
                    
                    try:
                        # 使用缓存的内容直接保存文件
                        safe_filename = Path(file_name).name
                        file_path = os.path.join(temp_dir, safe_filename)
                        # 使用上下文安全保存
                        try:
                            with open(file_path, "wb") as f:
                                f.write(content)  # 使用缓存的内容
                            logger.info(f"成功保存文件: {file_path} ({len(file_info['content'])} bytes)")
                            if not os.path.exists(file_path) or os.path.getsize(file_path) == 0:
                                logger.error(f"文件保存后检查失败: {file_path}")
                                raise FileNotFoundError(f"文件保存失败: {file_path}")
                        except Exception as save_error:
                            logger.error(f"文件保存错误: {file_info['filename']} - {str(save_error)}")
                            async_progress_store[task_id]["errors"].append(
                                f"{file_info['filename']} 保存失败: {str(save_error)}"
                            )
                            continue
                        
                        file_size = os.path.getsize(file_path)
                        # 创建文档记录
                        doc_id = await monitor.create_document(
                            batch_id=batch_id,
                            filename=file_info["filename"],  # 使用原始文件名
                            filetype=file_info["content_type"],
                            document_type=file_info["content_type"],
                            filesize=os.path.getsize(file_path),
                            filepath=file_path,
                            conn=conn
                        )
                        
                        # 分析参数对象
                        analysis_params = CombineInput(
                            files=[],
                            component=parameters["component"],
                            mode=parameters["mode"],
                            invert=parameters["invert"],
                            equalize=parameters["equalize"],
                            inclusive=parameters["inclusive"],
                            radius=parameters["radius"],
                            contrast=parameters["contrast"],
                            grayscale=parameters["grayscale"],
                            anti_forensics=parameters["anti_forensics"]
                        )
                        logger.debug(f"开始分析文件: {file_path} (类型: {type(file_path)})")
                        # 执行分析
                        analysis_result = await asyncio.to_thread(
                            cal_combined_analysis_no_async,
                            filepath=file_path,
                            filename=file_info["filename"],
                            data=analysis_params,
                            modes=["minimum", "average", "maximum"],
                            save_alert_images=True,
                            save_dir=temp_dir
                        )

                        # 拆包分析结果（确保变量名称一致）
                        (
                            stats_result_per_file, 
                            pca_result_per_file, 
                            alert_pages_per_file, 
                            _, 
                            detection_per_file, 
                            echo_result_per_file, 
                            exif_result_per_file
                        ) = analysis_result

                        # 更新告警统计
                        alert_pages_total += alert_pages_per_file

                        if alert_pages_per_file > 0:
                            alert_images.append(file_info["filename"])

                        # 添加文件级统计结果
                        stats_result.append(CombinFileAnalysisResult(
                            filename=safe_filename,
                            stats=stats_result_per_file
                        ))

                        # 处理分析结果
                        for stats_result_per in stats_result_per_file:
                            if stats_result_per["filename"] not in alertered_filename:
                                total_alerts += stats_result_per["alert"]
                                alertered_filename.append(stats_result_per["filename"])
                            
                            if stats_result_per["filename"] not in alertered_summary:
                                alertered_summary[stats_result_per["filename"]] = []
                            
                            for alert in stats_result_per.get("alerts", []):
                                for msg in alert.get("message", []):
                                    if msg not in alert_message_pixel:
                                        alert_message_pixel.append(msg)
                                    if msg not in alertered_summary[stats_result_per["filename"]]:
                                        alertered_summary[stats_result_per["filename"]].append(msg)

                        # 处理AI检测结果
                        for detection in detection_per_file:
                            if detection["result"] == "AI":
                                if detection["filename"] not in alertered_filename:
                                    total_alerts += 1
                                    alertered_filename.append(detection["filename"])
                                
                                if detection["filename"] not in alertered_summary:
                                    alertered_summary[detection["filename"]] = []
                                
                                if detection["alert_message"] not in alertered_summary[detection["filename"]]:
                                    alertered_summary[detection["filename"]].append(detection["alert_message"])
                                
                                if detection["alert_message"] not in alert_message_ai:
                                    alert_message_ai.append(detection["alert_message"])

                        # 处理PCA结果
                        for pca_result in pca_result_per_file:
                            if pca_result.filename not in alertered_filename:
                                total_alerts += pca_result.alert
                                alertered_filename.append(pca_result.filename)
                            
                            if pca_result.filename not in alertered_summary:
                                alertered_summary[pca_result.filename] = []
                            
                            for alert_message in pca_result.alert_message:
                                if alert_message not in alertered_summary[pca_result.filename]:
                                    alertered_summary[pca_result.filename].append(alert_message)
                                if alert_message not in alert_message_pca:
                                    alert_message_pca.append(alert_message)

                        # 添加检测结果到全局列表
                        detections.append(detection_per_file)
                        pca_results.append(pca_result_per_file)
                        exif_results.append(exif_result_per_file)

                        # 处理回波检测结果
                        count = 0
                        for echo_result in echo_result_per_file:
                            _filename = os.path.splitext(safe_filename)[0] + "_page_" + str(count + 1)
                            
                            echo_results.append(CombinEchoResult(
                                filename=_filename,
                                processing_time=echo_result["processing_time"],
                                image_size=echo_result["image_size"],
                                parameters=echo_result["parameters"],
                                forensic_warnings=echo_result["forensic_warnings"]
                            ))
                            count += 1
                            
                            if echo_result.get("forensic_warnings"):
                                if _filename not in alertered_filename:
                                    alertered_filename.append(_filename)
                                if _filename not in alertered_summary:
                                    alertered_summary[_filename] = []
                                
                                for warning in echo_result["forensic_warnings"]:
                                    if warning not in alertered_summary[_filename]:
                                        alertered_summary[_filename].append(warning)

                        # 处理EXIF结果
                        for exif_result in exif_result_per_file:
                            if exif_result["filename"] not in alertered_filename:
                                alertered_filename.append(exif_result["filename"])
                            
                            if exif_result["filename"] not in alertered_summary:
                                alertered_summary[exif_result["filename"]] = []
                            
                            for alert_message in exif_result.get("alert_message", []):
                                if alert_message not in alertered_summary[exif_result["filename"]]:
                                    alertered_summary[exif_result["filename"]].append(alert_message)
                                
                                if alert_message not in alert_message_metedata:
                                    alert_message_metedata.append(alert_message)

                        # ===== 构建文件结果 =====
                        file_result = {
                            "filename": safe_filename,
                            "filepath": file_path,
                            "filesize": os.path.getsize(file_path),
                            "type": file_info["content_type"],
                            "pages": []
                        }

                        # 添加页面级结果
                        for page_idx in range(len(pca_result_per_file)):
                            # 获取当前页的所有结果
                            stats_page = stats_result_per_file[page_idx] if page_idx < len(stats_result_per_file) else {}
                            pca_page = pca_result_per_file[page_idx] if page_idx < len(pca_result_per_file) else None
                            detection_page = detection_per_file[page_idx] if page_idx < len(detection_per_file) else {}
                            echo_page = echo_result_per_file[page_idx] if page_idx < len(echo_result_per_file) else {}
                            
                            page_result = {
                                "page": page_idx + 1,
                                "text_content": "",
                                "analysis": {
                                    "pca": {
                                        "alert": pca_page.alert if pca_page else 0,
                                        "pca_components": getattr(pca_page, 'pca_components', None),
                                        "cluster_analysis": getattr(pca_page, 'cluster_analysis', None)
                                    } if pca_page else {},
                                    "stats": {
                                        "alerts": stats_page.get("alerts", []),
                                        "intensity": stats_page.get("intensity", {})
                                    },
                                    "detection": {
                                        "model": detection_page.get("model"),
                                        "confidence": detection_page.get("confidence"),
                                        "result": detection_page.get("result")
                                    },
                                    "echo": echo_page.get("forensic_warnings")
                                },
                                "detection_status": "processed"
                            }
                            file_result["pages"].append(page_result)

                        # 添加文件级元数据
                        file_result["analysis"] = {
                            "component": parameters["component"],
                            "module_name": "Pixel & AI Analysis",
                            "alert_summary": alertered_summary.get(safe_filename, []),
                            "is_potential_fraud": "yes" if any([
                                len(alert_message_metedata) >= 1,
                                len(alert_message_pixel) >= 3,
                                len(alert_message_pca) >= 2,
                                len(alert_message_ai) >= 1
                            ]) else "no"
                        }
                        file_result["document_id"] = doc_id

                        # 添加到最终结果集
                        results.append(file_result)
                        
                        # 更新模块监控（成功）
                        await monitor.update_module_stats(
                            module_name="Enhanced Combined Analysis",
                            is_success=True,
                            conn=conn
                        )
                        
                    except Exception as e:
                        import traceback
                        tb = traceback.format_exc()
                        err_msg = f"File {file_name} processing failed: {str(e)}\n{tb}"
                        logger.error(err_msg)
                        # 记录完整错误到进度系统
                        async_progress_store[task_id]["errors"].append(err_msg)
                        
                        # 更新模块监控（失败）
                        await monitor.update_module_stats(
                            module_name="Enhanced Combined Analysis",
                            is_success=False,
                            conn=conn
                        )
                # 保存页面结果
                await monitor.create_pages_no_docid(
                    pages_data=results,
                    conn=conn
                )
                # 成功完成所有文件处理
                await monitor.update_job_status(
                    job_id=job_id,
                    status="completed",
                    conn=conn
                )
                
                async_progress_store[task_id].update({
                    "status": "completed",
                    "processed_files": len(file_contents)
                })
                
            except Exception as e:
                err_msg = f"分析任务失败: {str(e)}"
                async_progress_store[task_id].update({
                    "status": "failed",
                    "error": err_msg
                })
                
                if job_id:
                    await monitor.update_job_status(
                        job_id=job_id,
                        status="failed",
                        conn=conn
                    )
            finally:
                # 清理临时目录
                try:
                    shutil.rmtree(temp_dir)
                except Exception as e:
                    logger.warning(f"Temp dir cleanup failed: {str(e)}")

@app.get("/async-combined-progress/{task_id}")
async def get_async_progress(task_id: str):
    """获取异步任务进度"""
    progress = async_progress_store.get(task_id)
    if not progress:
        raise HTTPException(
            status_code=404,
            detail="任务ID不存在或已过期"
        )
    
    return {
        "status": progress["status"],
        "processed_files": progress["processed_files"],
        "total_files": progress["total_files"],
        "current_file": progress["current_file"],
        "batch_id": progress["batch_id"],
        "job_id": progress["job_id"],
        "errors": progress.get("errors", [])
    }


#############################################################################################

@app.get("/async-combined-progress/{task_id}")
async def get_async_progress(task_id: str):
    """获取异步任务进度"""
    progress = async_progress_store.get(task_id)
    if not progress:
        raise HTTPException(
            status_code=404,
            detail="任务ID不存在或已过期"
        )
    
    return {
        "status": progress["status"],
        "processed_files": progress["processed_files"],
        "total_files": progress["total_files"],
        "current_file": progress["current_file"],
        "batch_id": progress["batch_id"],
        "job_id": progress["job_id"],
        "errors": progress.get("errors", [])
    }


#############################################################################################
# ===== 3. 核心OCR处理接口 =====
@app.post("/ocr/")
async def ocr_endpoint(
    file: UploadFile = File(..., description="上传图片文件 (PNG/JPG)"),
    language: str = "chi_sim+eng"  # 默认中英文混合识别
):
    # 临时保存上传文件
    with tempfile.NamedTemporaryFile(delete=False, suffix=".png") as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name
    
    try:
        # 使用PIL打开图片
        img = Image.open(tmp_path)
        
        # Tesseract OCR识别
        text = pytesseract.image_to_string(
            img,
            lang=language,  # 语言配置
            config='--psm 6'  # 页面分段模式（适用于单文本块）
        )
        
        # 清理临时文件
        os.unlink(tmp_path)
        
        return JSONResponse(
            status_code=200,
            content={
                "filename": file.filename,
                "text": text.strip(),
                "language": language
            }
        )
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": f"OCR处理失败: {str(e)}"}
        )

def enhance_image(image):
    """
    图像增强处理:
        将上传图片转换为OpenCV可处理的numpy数组
        使用CLAHE（对比度受限自适应直方图均衡化）增强低对比度区域
        灰度化处理减少颜色干扰
    """
    img = np.array(image)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8,8))
    enhanced = clahe.apply(gray)
    return Image.fromarray(enhanced)
    #return Image.fromarray(gray)

def optimize_resolution(img, target_dpi=200):
    """将图像分辨率优化至目标DPI"""
    current_dpi = img.info.get('dpi', (72, 72))[0]
    if current_dpi < target_dpi * 0.8 or current_dpi > target_dpi * 1.2:
        scale_factor = target_dpi / current_dpi
        new_size = (int(img.width * scale_factor), int(img.height * scale_factor))
        return img.resize(new_size, Image.Resampling.LANCZOS)
    return img

def extract_amounts(text):
    """提取表格中的金额数据"""
    text = re.sub(r"\n+", "\n", text.strip())
    lines = [line.strip() for line in text.split('\n') if line.strip()]
    
    table_data = []
    # 匹配两种格式：1,234.56 或 1,234,56（后者将转换为标准格式）
    pattern = re.compile(
        r"\b\d{1,3}(?:\s*,\s*\d{3})*(?:\s*[.,]\s*\d{2,})\b|"  # 标准格式
        r"\b\d{1,3}(?:\s*,\s*\d{3})+\s*,\s*\d{2,}\b"          # 非常规格式
    )

    for line in lines:
        matches = pattern.findall(line)
        if matches:
            row = [float(normalize_number(amount)) 
                for amount in matches]
            table_data.append(row)
    
    return table_data

def normalize_number(num_str):
    # 处理非常规逗号分隔的小数（如1,234,56 → 1234.56）
    if ',' in num_str.split('.')[-1]:
        parts = num_str.rsplit(',', 1)
        num_str = f"{parts[0].replace(',', '')}.{parts[1]}"
    # 移除所有逗号和空格
    return num_str.replace(',', '').replace(' ', '')

def clean_numeric_string(text):
    return text.replace(' ', '').replace(',', '').strip()

def validate_sequence(table_data):
    """校验单列数字序列的加减关系（兼容二维列表输入）"""
    errors = []
    # 展平二维列表（假设每行只有1个元素）
    flat_data = [item[0] if isinstance(item, list) else item for row in table_data for item in (row if isinstance(row, list) else [row])]
    
    for i in range(2, len(flat_data), 2):
        a, b, expected = flat_data[i-2], flat_data[i-1], flat_data[i]
        if not (abs((a + b) - expected) < 1e-6 or 
               abs((a - b) - expected) < 1e-6):
            errors.append({
                'index': i,
                'values': (a, b, expected),
                'actual_sum': round(a + b, 6),
                'actual_diff': round(a - b, 6)
            })
    return errors

@app.post("/verify-invoice")
async def verify_invoice(file: UploadFile = File(...)):
    try:
        # 读取并预处理图片
        image = Image.open(io.BytesIO(await file.read()))
        processed_img = enhance_image(image)
        
        # OCR识别（配置中文+数字识别）
        '''
        OCR引擎模式(OEM)，推荐值:
            0：传统Tesseract引擎
            1：LSTM神经网络引擎
            2：传统+LSTM混合模式
            3：默认模式（自动选择最佳引擎）
        页面分割模式(PSM)，常见场景：
            3：全自动页面分割（默认）
            6：假设为统一文本块（适合表格/对齐文本）
            7：单行文本识别
            11：稀疏文本（如发票中的分散字段）
        进阶配置方案:
            发票表格识别	--psm 6 --oem 1	需配合图像预处理
            弯曲文本矫正	--psm 7 -c tessedit_char_whitelist=0123456789.	限定数字识别 (限定只识别数字和小数点)
            低质量图像	--psm 11 --oem 1 -c preserve_interword_spaces=1	增强抗干扰能力

        -c tessedit_char_whitelist=0123456789. 限定只识别数字和小数点   
        -c preserve_interword_spaces=1 保留空格
        -c min_character_confidenc=70 过滤低置信度结果
        '''
        custom_config = r'--oem 3 --psm 11 -c preserve_interword_spaces=1 -l chi_sim+eng'
        text = pytesseract.image_to_string(processed_img, config=custom_config)
        
        # 提取金额列
        amounts = extract_amounts(text)
        if not amounts:
            raise HTTPException(400, "未识别到金额数据")
        
        # 验证数据
        message = validate_sequence(amounts)
        
        # 提取声明合计值
        #total_match = re.search(r'合计[:：]?\s*(\d+\.\d{2})', text)
        #declared_total = float(total_match.group(1)) if total_match else None
        
        return JSONResponse({
            "status": "success",
            "data": {
                "amounts": amounts,
                "text_preview": text,
                "message": message
            }
        })
        
    except Exception as e:
        raise HTTPException(500, f"处理错误: {str(e)}")

# 日期识别（提取表格中的日期列）
def extract_dates(text):
    # 正则匹配日期格式（如 01DEC23）
    date_pattern = r"\b\d{2}[A-Z]{3}\d{2}\b"
    dates = re.findall(date_pattern, text)
    return dates

#####################################################new ocr通用模板###########################################
# 银行账单模板配置
BANK_TEMPLATES = {
    "ICBC": {
        "date_pattern": r"\d{4}-\d{2}-\d{2}",
        "amount_pattern": r"-?\d+\.\d{2}",
        "header_lines": 3,
        "footer_lines": 2
    },
    "CCB": {
        "date_pattern": r"\d{2}/\d{2}/\d{4}",
        "amount_pattern": r"\$?\d{1,3}(?:,\d{3})*\.\d{2}",
        "header_lines": 4,
        "footer_lines": 1
    },
    # 新增东亚银行配置 
    "BEA": {
        "date_pattern": r"\b((?=[A-Z0-9]{7}\b)(?=[^A-Z]*[A-Z])(?=[^0-9]*[0-9])[A-Z0-9]{7})\b",
        "amount_pattern": r'(\d+\s*,\s*\d+\s*\.\s*\d+)|(\d+\s*\.\s*\d+\s*\.\s*\d+)',
        "statement_period": r"Statement Period.*?[:：]\s*(\d{1,2}\s+[A-Za-z]{3}\s+\d{4})\s*-\s*(\d{1,2}\s+[A-Za-z]{3}\s+\d{4})",
        "desc_pattern": r'[\u4e00-\u9fff]+(\s+[\u4e00-\u9fff]+)*',
        "header_lines": 7,
        "footer_lines": 1
    },
    # 新增交通银行香港配置 
    "bocomhk": {
        "date_pattern": r"\d{4}年\d{2}月\d{2}日",  # 中文日期格式
        "amount_pattern": r"(HKD|USD|CNY)\s?\d+\.\d{2}",  # 币种+金额
        "header_lines": 4,
        "footer_lines": 1
    }
}

def stable_preprocess(img):
    """稳定的图像预处理函数"""
    # 确保输入是numpy数组
    if isinstance(img, Image.Image):
        img_array = np.array(img)
    else:
        img_array = img
        
    # 转换为BGR格式（如果是RGB）
    if len(img_array.shape) == 3 and img_array.shape[2] == 3:
        img_array = cv2.cvtColor(img_array, cv2.COLOR_RGB2BGR)
    
    # 转灰度
    gray = cv2.cvtColor(img_array, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8,8))
    return clahe.apply(gray)

def parse_bank_statement(image_data, data):
    """解析银行账单核心逻辑"""
    #processed_img = enhance_image(Image.open(io.BytesIO(image_data)))
    # 转为灰度图提升识别率
    img = Image.open(io.BytesIO(image_data))

    # 确保转换为numpy数组
    img_array = np.array(img)
    processed_img = stable_preprocess(img_array)
    processed_img = Image.fromarray(processed_img)

    #processed_img = processed_img.convert('L')
    #processed_img = optimize_resolution(processed_img)
    
    ocr_config = build_ocr_config(data)
    print(f"OCR Config: {ocr_config}")

    #custom_config = f'--oem 3 -c preserve_interword_spaces=1 -l chi_sim+chi_tra+eng'
    #custom_config = f'--oem 3' 是最好的
    #custom_config = r'--oem 3 --psm 11 -c tessedit_char_whitelist=0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ/-\s$ -l chi_sim+eng'
    #custom_config = f'--oem 3 --psm 6'
    #text = pytesseract.image_to_string(image_data, lang='chi_sim+chi_tra+eng', custom_config=custom_config)
    #text = re.sub(r"\n+", "\n", text.strip())
    #text = pytesseract.image_to_string(processed_img)
    #lines = [line.strip() for line in text.split('\n') if line.strip()]
    if data.best_mode:
        #os.environ['TESSDATA_PREFIX'] = r'C:\Temp\pythonProject\backend_api\Tesseract-OCR\tessdata_best'
        # 获取项目根目录路径 (backend_api所在目录)

        #BASE_DIR = Path(__file__).resolve().parent  # 如果脚本在项目根目录下
        BASE_DIR = Path(__file__).resolve().parent.parent  # 如果脚本在app子目录中

        # 设置跨平台路径
        tessdata_dir = BASE_DIR / "Tesseract-OCR" / "tessdata_best"

        # 验证路径是否存在
        if not tessdata_dir.exists():
            raise FileNotFoundError(f"Tessdata目录不存在: {tessdata_dir}")

        os.environ['TESSDATA_PREFIX'] = str(tessdata_dir)
        print(f"TESSDATA_PREFIX已设置为: {os.environ['TESSDATA_PREFIX']}")

    text = pytesseract.image_to_string(processed_img, config=ocr_config["config"],lang=ocr_config["lang"])
    #text = pytesseract.image_to_string(processed_img, config=custom_config,lang='chi_sim+chi_tra+eng')
    #text = pytesseract.image_to_string(processed_img, config=custom_config,lang=ocr_config["lang"])
    #text = pytesseract.image_to_string(processed_img, config=ocr_config["config"],lang=ocr_config["lang"])
    template_type = data.template_type
    lines = text.split("\n")
    # 根据银行类型应用模板
    template = BANK_TEMPLATES.get(template_type, {})
    processed_lines = lines[template["header_lines"]:-template["footer_lines"]]

    time_list = []
    alert_time_list = []
    desc_list = []
    amount_list = []

    date_alert_message = []
    amount_alert_message = []
    desc_alert_message = []
    amount_data_list = []

    for line in processed_lines:
        # 去除首尾空白字符后检查是否为空
        stripped_line = line.strip()
        if not stripped_line:  # 空行检测
            continue
        print(f"Line: {line}")
        period_pattern = f'{template["statement_period"]}'
        match = re.search(period_pattern, stripped_line)
        if match and "Statement Period" in stripped_line:  # 添加这行检查
            start_str, end_str = match.groups()
            try:
                start_date = datetime.strptime(start_str, "%d %b %Y").date()
                end_date = datetime.strptime(end_str, "%d %b %Y").date()
                print(f'发现日期范围: {start_date} 至 {end_date}')
            except ValueError:
                print(f'无效日期格式: {start_str} - {end_str}')
        else:
            # 提取7位数字字母组合的时间（如30NOV23或01DEC23）
            date_pattern = f'{template["date_pattern"]}'
            time_match = re.search(date_pattern, stripped_line)
            if time_match:
                time_str = time_match.group(1)
                # 将时间字符串转换为日期对象
                try:
                    # 假设时间格式是 DDMMMYY，需要转换为 DD MMM YYYY
                    day = time_str[:2]
                    month = time_str[2:5]
                    year = "20" + time_str[5:]  # 假设是21世纪
                    transaction_date = datetime.strptime(f"{day} {month} {year}", "%d %b %Y").date()
                    
                    # 检查日期是否在范围内
                    if 'start_date' in locals() and 'end_date' in locals():
                        if not (start_date <= transaction_date <= end_date):
                            alert_time_list.append(time_str)
                            if "Transcation Dates Outside Statements" not in date_alert_message:
                                date_alert_message.append("Transcation Dates Out of Statement Range")
                            print(f'警告: 日期 {transaction_date} 不在账单范围 {start_date} 至 {end_date} 内')
                    
                    time_list.append(time_str)
                except ValueError as e:
                    print(f'日期转换错误 {time_str}: {str(e)}')
                    if "Date out of Reference Range" not in date_alert_message:
                         date_alert_message.append("Date out of Reference Range")
                    continue 
            # 提取描述部分（从第15个字符开始到最后一个数字前）
            # 匹配中文和空格，直到遇到数字或结束
            desc_pattern = f'{template["desc_pattern"]}'
            desc_match = re.search(desc_pattern, stripped_line)
            if desc_match:
                # 提取匹配内容并去除所有空格
                desc = desc_match.group().replace(' ', '')
                desc_list.append(desc)
            # 提取金额部分
            amount_pattern = f'{template["amount_pattern"]}'
            matches = re.findall(amount_pattern, stripped_line)
            for match in matches:
            # 合并两个捕获组的结果
                amount = match[0] or match[1]
                # 去除所有空格并存入列表
                amount_list.append(amount.replace(" ", ""))

                amount_clean = amount.replace(" ", "")
                row = [float(normalize_number(amount_clean))]
                amount_data_list.append(row)

    print("时间列表:", time_list)
    print("描述列表:", desc_list)
    print("金额列表:", amount_list)

    amount_data_errors_list = validate_sequence(amount_data_list)
    # 计算错误比例并判断
    if len(amount_list) > 0:  # 避免除零错误
        error_ratio = len(amount_data_errors_list) / len(amount_list)
        if error_ratio >= 0.1:  # 错误比例达到10%
            print(f"警告：金额错误率达到 {error_ratio*100:.1f}% ({len(amount_data_errors_list)}/{len(amount_list)})")
            amount_alert_message.append(f"High Amount Error Rate: {error_ratio*100:.1f}%")
    else:
        print("警告：未找到任何金额数据")
    new_text = text.replace('\n', '<br>') if text is not None else ""
    return date_alert_message,amount_alert_message,new_text

def build_ocr_config(data) -> dict:
    """构建OCR识别配置参数
    
    Args:
        data: 包含OCR配置的输入对象
    
    Returns:
        dict: 包含处理后的图像和配置参数的字典
    """
    custom_config = f'--oem {data.oem}'
    if data.psm:
        custom_config += f' --psm {data.psm}'
    
    lang_param = build_lang_param(data.lang)
    return {
        'config': custom_config,
        'lang': lang_param
    }

def build_lang_param(lang_list):
    """将语言列表转换为加号连接的字符串
    
    Args:
        lang_list: 语言字符串列表
        
    Returns:
        str: 加号连接的语言字符串
    """
    if not isinstance(lang_list, list):
        raise TypeError("输入必须是列表类型")
    
    # 过滤空值并去除前后空格

    test= []

    for item in lang_list:
        test=item.split(',')
    return '+'.join(test)

    #valid_langs = [lang.strip() for lang in lang_list if lang and str(lang).strip()]
    #return '+'.join(valid_langs)


OEM = Literal["0", "1", "2", "3"]
PSM = Literal["","3", "6", "7", "11"]
TEMPLATE_TYPE = Literal["BEA"]

class OcrInput(BaseModel):
    files: List[UploadFile] = File(...)
    template_type: TEMPLATE_TYPE="BEA"
    oem: OEM = "3"
    psm: PSM = ""
    # Use the friendly language names
    lang: List[str] = Field(default_factory=lambda: ['chi_sim', 'chi_tra', 'eng'])
    best_mode : bool = True

    @classmethod
    def as_form(
        cls,
        files: List[UploadFile] = File(...),
        template_type: TEMPLATE_TYPE = Form("BEA"),
        oem: OEM = Form("3"),
        psm: PSM = Form(""),      
        lang: List[str] = Form(['chi_sim', 'chi_tra', 'eng']),
        best_mode: bool = Form(True)
    ):
        return cls(
            files=files,
            template_type=template_type,
            oem=oem,
            psm=psm,
            lang=lang,
            best_mode=best_mode
        )

@app.post("/ocr/analyze")
async def analyze_statement(
    data: OcrInput = Depends(OcrInput.as_form),
    monitor: ModuleMonitorService = Depends(lambda: ModuleMonitorService(app.state.pool))
):
    temp_dir = tempfile.mkdtemp()
    results = []
    try:
        for file_index, file in enumerate(data.files):
            filename = file.filename
            print(f"Processing {file_index} file: {filename}")
            file_path = os.path.join(temp_dir, filename)

            with open(file_path, "wb") as f:
                f.write(await file.read())
            # 直接读取文件数据
            #file_data = await file.read()
            #mimetype, _ = mimetypes.guess_type(file_path)
            # 通过文件名猜测MIME类型
            mimetype, _ = mimetypes.guess_type(filename)
            try:
                #if mimetype and mimetypes.guess_type(file_path)[0].startswith("image"):
                if mimetype and mimetype.startswith("image"):
                    
                    # Process single image
                    # 读取文件内容作为二进制数据传递
                    with open(file_path, "rb") as f:
                        image_data = f.read()
                    date_alert_message,amount_alert_message,text = parse_bank_statement(image_data, data)
                #elif mimetype == "application/pdf" or file_path.lower().endswith(".pdf"):
                elif mimetype == "application/pdf" or filename.lower().endswith(".pdf"):
                    # Process PDF
                    doc = fitz.open(file_path)
                    #doc = fitz.open(stream=file_data)
                    for i, page in enumerate(doc):
                        # 使用英文文件名
                        base_filename = "page" + str(i + 1)
                        pix = page.get_pixmap()
                        tmp_img_path = os.path.join(temp_dir, f"{base_filename}.jpg")
                        tmp_img_path = os.path.abspath(tmp_img_path)  # 使用绝对路径
                        pix.save(tmp_img_path)
                        
                        # 创建内存中的RGB图像
                        #img_data = io.BytesIO()
                        #pix.save(img_data, format="JPEG")
                        pix = None  # 及时释放内存
                        '''
                        # 确保图像为RGB格式
                        img = Image.open(img_data)
                        if img.mode == "RGBA":
                            img = img.convert("RGB")
                            img_data = io.BytesIO()
                            img.save(img_data, format="JPEG")
                            img_data.seek(0)
                        '''
                        with open(tmp_img_path, "rb") as f:
                            file_data_for_parse = f.read()
                        # 解析对账单
                        date_alert_message,amount_alert_message,text = parse_bank_statement(file_data_for_parse, data)

                        '''
                        # 确保图片为RGB
                        try:
                            img = Image.open(tmp_img_path)
                            if img.mode == "RGBA":
                                img = img.convert("RGB")
                                img.save(tmp_img_path)
                        except Exception as e:
                            print(f"Error converting image to RGB: {e}")
                            continue
                        transactions = parse_bank_statement(file_path, data)
                        '''
                else:
                    raise ValueError("Unsupported file type")
            except Exception as e:
                print(f"Error processing file {filename}: {e}")
                continue

            desc_alert = "pass"
            amount_alert = "pass"
            date_alert = "pass"
            if len(date_alert_message) >= 1:
                date_alert = "fail"
            if len(amount_alert_message) >= 1:
                amount_alert = "fail"
            potential_fraud = "no"
            if(amount_alert=="fail" or date_alert=="fail"):
                potential_fraud = "yes"
            results.append({
                "filename": filename,
                "potential_fraud":potential_fraud,
                "date_alert_message":date_alert_message,
                "amount_alert_message":amount_alert_message,
                "date_alert": date_alert,
                "amount_alert": amount_alert,
                "desc_alert":"pass",
                "text":text
            })
        # 处理结果
        is_success = True  
        module_stats = await monitor.update_module_stats(
            module_name="Text Consistency Check",
            is_success=is_success
        )
        return results
    except Exception as e:
        is_success = False  
        module_stats = await monitor.update_module_stats(
            module_name="Text Consistency Check",
            is_success=is_success
        )
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            shutil.rmtree(temp_dir)
        except Exception:
            pass



class ModuleMonitor(BaseModel):
    id: int
    module_name: str
    files_processed_num: int
    success_num: int
    failure_num: int
    created_time: datetime
    updated_time: datetime
    # 新增字段
    success_rate: str  # 成功率百分比字符串 (如 "95.00%")
    risk_rate: str     # 风险率百分比字符串 (如 "5.00%")
    api_status: str    # 状态标识 (green/yellow/red)

    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }

# 查询所有模块数据
@app.get("/modules", response_model=List[ModuleMonitor])
async def get_all_modules():
    async with app.state.pool.acquire() as conn:
        try:
            # 获取原始数据
            records = await conn.fetch(
                "SELECT * FROM module_monitor ORDER BY files_processed_num DESC"
            )
            
            # 处理每条记录计算新增字段
            processed_records = []
            for record in records:
                # 转换为字典以便修改
                record_dict = dict(record)
                
                # 计算成功率（处理除数为0的情况）
                files_processed = record_dict.get('files_processed_num', 0)
                success_num = record_dict.get('success_num', 0)
                failure_num = record_dict.get('failure_num', 0)
                
                # 计算成功率
                if files_processed > 0:
                    success_rate = round((success_num / files_processed) * 100, 2)
                    risk_rate = round((failure_num / files_processed) * 100, 2)
                else:
                    success_rate = 0.0
                    risk_rate = 0.0
                
                # 添加计算字段
                record_dict['success_rate'] = f"{success_rate}%"
                record_dict['risk_rate'] = f"{risk_rate}%"
                
                # 根据成功率设置状态
                if success_rate == 100.00:
                    record_dict['api_status'] = 'green'
                elif success_rate >= 90.0:
                    record_dict['api_status'] = 'yellow'
                else:
                    record_dict['api_status'] = 'red'
                print(f'{record_dict}')
                processed_records.append(record_dict)
            
            return processed_records
            
        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"Database query error: {str(e)}"
            )

########################## muass upload dashboard start #########################
class BatchStat(BaseModel):
    batch_id: int
    batch_name: str
    total_files: int
    success_files: int
    success_rate: float
    failed_files: int       # 新增失败文件数字段
    status: str             # 新增状态字段
    created_at: Optional[str] = None    # 新增创建时间字段

class BatchStatsResponse(BaseModel):
    overall_stats: BatchStat
    batch_stats: List[BatchStat]

@app.get("/massupload/dashboard", response_model=BatchStatsResponse)
async def get_batch_stats():
    async with app.state.pool.acquire() as conn:
        # 1. 获取批次信息（含创建时间）
        batch_records = await conn.fetch(
            "SELECT id, name, created_at FROM batch WHERE name IN ('Pixel & AI Analysis', 'Text Consistency Analysis')"
        )
        if not batch_records:
            return JSONResponse(status_code=404, content={"message": "No batches found"})
        
        batch_ids = [r['id'] for r in batch_records]
        batch_info = {
            r['id']: {
                "name": r['name'],
                "created_at": r['created_at'].strftime("%Y-%m-%d %H:%M:%S")
            } for r in batch_records
        }

        # 2. 获取文件处理状态
        doc_query = """
        SELECT
            d.batch_id,
            BOOL_AND(p.detection_status = 'processed') AS processed_all
        FROM document d
        LEFT JOIN page p ON d.id = p.document_id
        WHERE d.batch_id = ANY($1)
        GROUP BY d.id, d.batch_id
        """
        doc_results = await conn.fetch(doc_query, batch_ids)

        # 3. 数据结构初始化（新增状态字段）
        stats_map: Dict[str, Dict[str, Any]] = {
            "overall": {
                "batch_id": 0,
                "batch_name": "Overall",
                "total_files": 0,
                "success_files": 0,
                "created_at": None  # 整体统计无创建时间
            }
        }
        for bid in batch_ids:
            stats_map[bid] = {
                "batch_id": bid,
                "batch_name": batch_info[bid]["name"],
                "total_files": 0,
                "success_files": 0,
                "created_at": batch_info[bid]["created_at"]  # 批次创建时间
            }

        # 4. 统计数据聚合
        for doc in doc_results:
            batch_id = doc['batch_id']
            stats_map[batch_id]['total_files'] += 1
            stats_map['overall']['total_files'] += 1
            
            if doc['processed_all']:
                stats_map[batch_id]['success_files'] += 1
                stats_map['overall']['success_files'] += 1

        # 5. 计算衍生字段（失败数 & 状态）
        def calc_derived_fields(stat: Dict[str, Any]) -> Dict[str, Any]:
            total = stat['total_files']
            success = stat['success_files']
            
            # 计算失败文件数
            stat['failed_files'] = total - success
            
            # 计算成功率（处理除零错误）
            stat['success_rate'] = round(success/total, 4) if total else 0.0
            
            # 计算状态（100%成功=success，否则=error）
            stat['status'] = "success" if success == total else "error"
            return stat

        # 6. 构建响应模型
        overall_stat = BatchStat(
            **calc_derived_fields(stats_map['overall'])
        )
        
        batch_stats_list = [
            BatchStat(**calc_derived_fields(stats_map[bid])) 
            for bid in batch_ids
        ]

        return BatchStatsResponse(
            overall_stats=overall_stat,
            batch_stats=batch_stats_list
        )
########################## muass upload dashboard end #########################

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
