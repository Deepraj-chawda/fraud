from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, status, Form, Query
from sqlalchemy.orm import Session
from fastapi.responses import JSONResponse, FileResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from db import get_db, User # Importing DB session helper
from auth import (create_access_token, register_user, get_user_by_email, get_all_users, delete_user,
                  verify_token, edit_user, reset_password, get_user_by_username) # Importing authentication logic
from exif_api import extract_exif  # Custom EXIF extraction logic
from header_api import extract_header  # Custom Header extraction logic
import os
from pydantic import BaseModel
import logging
from datetime import datetime
from typing import List
from fastapi.middleware.cors import CORSMiddleware
from detect_AI import detect_ai_image, DetectionResult
import shutil
import tempfile
from typing import Dict, Any
from facecomparison import process_single_file, compare_faces, FaceCompareInput, FolderComparisonResult
from pixel_analysis import ModeType, get_pixel_stats, compute_pixel_stats, FileAnalysisResult, ImageStatsResponse, ImageStatsInput, MODE_THRESHOLDS
import base64
import cv2
from pdf2image import convert_from_path
from typing import Optional, Literal
from copymove import process_image, CopyDetectionResult, CopyMoveFormInput
from edge_detection import process_echo_edge, EchoEdgeResult, EchoEdgeFormInput
from error_level import apply_ela_processing, ElaResponse, ElaRequest
from pca_analysis import process_pca, PCAResult, PCAInput, AnalysisResults
import uuid
from pathlib import Path

# Define a Pydantic model for the User response
class UserResponse(BaseModel):
    email: str
    username: str
    password: str
    role: str
    last_updated: datetime

    class Config:
        orm_mode = True  # This will tell Pydantic to treat SQLAlchemy objects as data models

class LoginInput(BaseModel):
    email: str
    password: str

# Initialize FastAPI application
app = FastAPI()

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

# Helper function to save uploaded image
def save_uploaded_image(image: UploadFile):
    """
    Saves the uploaded image to a static folder.

    Args:
        image (UploadFile): The uploaded image file.

    Returns:
        str: The file path where the image is saved.

    Raises:
        HTTPException: If there is an error while saving the file.
    """
    try:
        upload_folder = 'static'
        # Create the folder if it doesn't exist
        if not os.path.exists(upload_folder):
            os.makedirs(upload_folder)

        # Extract the file extension from the uploaded image
        ext = image.filename.rsplit('.', 1)[1].lower()
        namefile = f"uploaded.{ext}"
        filepath = os.path.join(upload_folder, namefile)

        # Save the image to the upload folder
        with open(filepath, 'wb') as file:
            file.write(image.file.read())

        return filepath
    except Exception as e:
        # Log and raise an error if something goes wrong while saving
        logger.error(f"Error saving image: {str(e)}")
        raise HTTPException(status_code=500, detail="Error saving the uploaded image")


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
@app.post('/exif')
async def exif(files: List[UploadFile] = File(...), current_user: User = Depends(get_current_user),db: Session = Depends(get_db)):
   
    """
    Extracts EXIF metadata from an uploaded image.
    This endpoint is protected with JWT authentication.

    Args:
        image (UploadFile): The uploaded image file to extract EXIF data from.
        current_user (User): The authenticated user (extracted from JWT).
        db (Session): The database session.

    Returns:
        JSONResponse: JSON object containing structured EXIF metadata.

    Raises:
        HTTPException:
            - 401: If the JWT token is invalid or expired.
            - 404: If no EXIF data is found in the image.
            - 500: If an internal server error occurs during processing.
    """
    try:


        # Save the uploaded image and process EXIF extraction
        """
        修改：
        1. 把上传单一image格式，实现支持批量上传功能
        2. 支持各种图像格式（例如JPG、HEIC、HEIF、PDF）
        3. 批量上传过程中的实时进度跟踪。
        4. 在单个会话内自动生成所有上传文档的分析结果。
        """

        filepath = save_uploaded_image(files)

        exif_data = extract_exif(files)

        if not exif_data:
            raise HTTPException(status_code=404, detail="No EXIF data found in the image")

        # Return the extracted EXIF metadata
        return JSONResponse(content=exif_data)

    except HTTPException as e:
        # Re-raise the handled exception (401, 404)
        raise e
    except Exception as e:
        # Log the internal error and raise a 500 HTTPException
        logger.error(f"Internal Server Error in EXIF extraction: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error during EXIF extraction")


#9. Detect AI or NOT API Endpoints
@app.post("/detect-ai-single", response_model=DetectionResult)
async def detect_single_image(
        image: UploadFile = File(...),
        current_user: dict = Depends(get_current_user)
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
            "human_probability": detection["human_probability"],
            "ai_probability": detection["ai_probability"]
        }
    except HTTPException as e:
        raise e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

#10. Detect AI or NOT folder API Endpoints

@app.post("/detect-ai-images", response_model=Dict[str, Any])
async def detect_images(
        files: List[UploadFile] = File(...),
        current_user: dict = Depends(get_current_user)
):
    """Detect AI in multiple uploaded images"""
    try:
        results = {
            "images": [],
            "total_files": 0,
            "human_count": 0,
            "ai_count": 0,
            "error_images": []
        }

        # Create a temporary directory for processing
        temp_dir = tempfile.mkdtemp()

        for file in files:
            try:
                # Save the uploaded file temporarily
                file_path = os.path.join(temp_dir, file.filename)
                with open(file_path, "wb") as f:
                    f.write(file.file.read())

                # Only process image files
                if file.filename.lower().endswith(('.jpg', '.jpeg', '.png', '.svg', '.bmp', '.gif', '.tiff', '.tif')):
                    try:
                        detection = detect_ai_image(file_path)
                        if detection["result"] == "human":
                            results["human_count"] += 1
                        else:
                            results["ai_count"] += 1

                        results["images"].append({
                            "filename": file.filename,
                            "result": detection["result"],
                            "human_probability": detection["human_probability"],
                            "ai_probability": detection["ai_probability"]
                        })
                    except Exception as e:
                        results["error_images"].append({
                            "filename": file.filename,
                            "error": str(e)
                        })
                else:
                    # Skip non-image files
                    continue

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
        return results

    except HTTPException as e:
        raise e
    except Exception as e:
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




@app.post("/detect-copy-move",response_model=CopyDetectionResult)
async def detect_copy_move_api(
        data: CopyMoveFormInput = Depends(CopyMoveFormInput.as_form),
        current_user: User = Depends(get_current_user)
):
    image = data.image
    mask = data.mask
    detector = data.detector
    response_threshold = data.response_threshold
    matching_threshold = data.matching_threshold
    distance_threshold = data.distance_threshold
    cluster_size = data.cluster_size
    show_keypoints = data.show_keypoints
    hide_lines = data.hide_lines
    use_mask = data.use_mask
    """API endpoint matching all conditions from the Qt widget"""
    try:
        # Create temp directory
        temp_dir = tempfile.mkdtemp()

        # Save input files
        image_path = os.path.join(temp_dir, image.filename)
        with open(image_path, "wb") as f:
            f.write(image.file.read())

        mask_path = None
        if mask and use_mask:
            mask_path = os.path.join(temp_dir, mask.filename)
            with open(mask_path, "wb") as f:
                f.write(mask.file.read())

        # Process image
        result = process_image(
            image_path=image_path,
            detector_type=detector,
            response_threshold=response_threshold,
            matching_threshold=matching_threshold,
            distance_threshold=distance_threshold,
            cluster_size=cluster_size,
            show_keypoints=show_keypoints,
            hide_lines=hide_lines,
            mask_path=mask_path,
            use_mask=use_mask
        )

        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])

        # Encode result image
        _, encoded_img = cv2.imencode(".jpg", result["output_image"])
        base64_img = base64.b64encode(encoded_img).decode("utf-8")

        return JSONResponse(content={
            "total_keypoints": result["total_keypoints"],
            "filtered_keypoints": result["filtered_keypoints"],
            "matches": result["matches"],
            "clusters": result["clusters"],
            "regions": int(result["regions"]),
            "processing_time": result["processing_time"],
            "result_image": base64_img
        })

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        # Clean up
        try:
            if 'image_path' in locals() and os.path.exists(image_path):
                os.remove(image_path)
            if 'mask_path' in locals() and os.path.exists(mask_path):
                os.remove(mask_path)
            if 'temp_dir' in locals() and os.path.exists(temp_dir):
                os.rmdir(temp_dir)
        except:
            pass


@app.post("/echo-edge-filter", response_model=EchoEdgeResult)
async def echo_edge_filter_api(
        data: EchoEdgeFormInput = Depends(EchoEdgeFormInput.as_form),
        current_user: dict = Depends(get_current_user)
):
    """API endpoint for echo edge detection with parameters matching the Qt widget"""
    try:
        # Create temp directory
        temp_dir = tempfile.mkdtemp()
        image_path = os.path.join(temp_dir, data.image.filename)

        # Save input file
        with open(image_path, "wb") as f:
            f.write(await data.image.read())

        # Process image
        result = process_echo_edge(
            image_path=image_path,
            radius=data.radius,
            contrast=data.contrast,
            grayscale=data.grayscale
        )

        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])

        # Encode result image
        _, encoded_img = cv2.imencode(".jpg", result["output_image"])
        base64_img = base64.b64encode(encoded_img).decode("utf-8")

        return {
            "processing_time": result["processing_time"],
            "image_size": result["image_size"],
            "parameters": result["parameters"],
            "result_image": base64_img
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/errorlevel/", response_model=ElaResponse)
async def perform_ela(
        request: ElaRequest = Depends(ElaRequest.as_form),
current_user: dict = Depends(get_current_user)
) :
    try:
        # Create temp directory
        temp_dir = tempfile.mkdtemp()

        # Save input files
        image_path = os.path.join(temp_dir, request.image.filename)
        with open(image_path, "wb") as f:
            f.write(request.image.file.read())

        if request.image is None:
            raise HTTPException(status_code=400, detail="Invalid image file")

        # Process image
        ela_img, metadata = apply_ela_processing(
            image=image_path,
            quality=request.quality,
            scale=request.scale,
            contrast=request.contrast,
            linear=request.linear,
            grayscale=request.grayscale
        )




        # Encode result image
        _, encoded_img = cv2.imencode(".jpg", ela_img)
        base64_img = base64.b64encode(encoded_img).decode("utf-8")

        return {
        "processing_time": metadata["processing_time"],
        "original_quality": metadata["original_quality"],
        "output_scale": metadata["output_scale"],
        "contrast": metadata["contrast"],
        "linear": metadata["linear"],
        "grayscale": metadata["grayscale"],
        "image_size": metadata["image_size"] ,
        "result_image": base64_img
    }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))




