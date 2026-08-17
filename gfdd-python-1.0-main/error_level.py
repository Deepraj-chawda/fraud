from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import List, Dict, Optional
import cv2 as cv
import numpy as np
import time
import base64
from utility import  desaturate, create_lut, read_gif_with_pillow


progress_data: Dict[str, Dict] = {}

class ElaRequest(BaseModel):
    files: List[UploadFile] = Field(...)
    quality: int = Field(75, ge=1, le=100)
    scale: int = Field(50, ge=1, le=100)
    contrast: int = Field(20, ge=0, le=100)
    linear: bool = Field(False)
    grayscale: bool = Field(False)

    @classmethod
    def as_form(
        cls,
        files: List[UploadFile] = File(...),
        quality: int = Form(75),
        scale: int = Form(50),
        contrast: int = Form(20),
        linear: bool = Form(False),
        grayscale: bool = Form(False),
    ):
        return cls(
            files=files,
            quality=quality,
            scale=scale,
            contrast=contrast,
            linear=linear,
            grayscale=grayscale,
        )

class ElaResponse(BaseModel):
    results: List[Dict] = Field(...)

class ProgressResponse(BaseModel):
    progress: float
    status: str
    current_file: Optional[str] = None

def compress_jpg(image: np.ndarray, quality: int) -> np.ndarray:
    """Compress image using JPEG with specified quality"""
    _, buffer = cv.imencode('.jpg', image, [int(cv.IMWRITE_JPEG_QUALITY), quality])
    return cv.imdecode(buffer, cv.IMREAD_COLOR)

async def apply_ela_processing(
    image_path: str, 
    quality: int = 75,
    scale: int = 50,
    contrast: int = 20,
    linear: bool = False,
    grayscale: bool = False
) -> Dict:
    """
    Perform Error Level Analysis on an image

    Args:
        image_path: Path to the input image file
        quality: JPEG compression quality (1-100)
        scale: Output scaling factor (1-100)
        contrast: Contrast adjustment (0-100)
        linear: Whether to use linear absolute difference
        grayscale: Convert to grayscale

    Returns:
        dict: A dictionary containing the processed image (base64 encoded) and metadata
    """
    start_time = time.time()
    image = cv.imread(image_path)
    if image is None:
        return {
            "error": "Invalid image file"
        }

    original = image.astype(np.float32) / 255
    compressed = compress_jpg(image, quality)

    if not linear:
        difference = cv.absdiff(original, compressed.astype(np.float32) / 255)
        ela = cv.convertScaleAbs(cv.sqrt(difference) * 255, None, scale / 20)
    else:
        ela = cv.convertScaleAbs(cv.subtract(compressed, image), None, scale)

    contrast_val = int(contrast / 100 * 128)
    ela = cv.LUT(ela, create_lut(contrast_val, contrast_val))

    if grayscale:
        ela = desaturate(ela)

    _, encoded_img = cv.imencode(".jpg", ela)
    base64_img = base64.b64encode(encoded_img).decode("utf-8")

    metadata = {
        "processing_time": time.time() - start_time,
        "original_quality": quality,
        "output_scale": scale,
        "contrast": contrast,
        "linear": linear,
        "grayscale": grayscale,
        "image_size": (ela.shape[1], ela.shape[0]),  # (width, height)
        "result_image": base64_img
    }

    return metadata

def apply_ela_processing_no_async(
    image_path: str, 
    quality: int = 75,
    scale: int = 50,
    contrast: int = 20,
    linear: bool = False,
    grayscale: bool = False
) -> Dict:
    """
    Perform Error Level Analysis on an image

    Args:
        image_path: Path to the input image file
        quality: JPEG compression quality (1-100)
        scale: Output scaling factor (1-100)
        contrast: Contrast adjustment (0-100)
        linear: Whether to use linear absolute difference
        grayscale: Convert to grayscale

    Returns:
        dict: A dictionary containing the processed image (base64 encoded) and metadata
    """
    start_time = time.time()
    if image_path.lower().endswith('.gif'):
        # 如果是GIF文件，使用Pillow读取
        image = read_gif_with_pillow(image_path)
        if image is None:
            return {"error": "Invalid GIF file"}
    else:
        # 对于非GIF文件，使用OpenCV读取
        image = cv.imread(image_path)
        if image is None:
            return {"error": "Invalid image file"}

    original = image.astype(np.float32) / 255
    compressed = compress_jpg(image, quality)

    if not linear:
        difference = cv.absdiff(original, compressed.astype(np.float32) / 255)
        ela = cv.convertScaleAbs(cv.sqrt(difference) * 255, None, scale / 20)
    else:
        ela = cv.convertScaleAbs(cv.subtract(compressed, image), None, scale)

    contrast_val = int(contrast / 100 * 128)
    ela = cv.LUT(ela, create_lut(contrast_val, contrast_val))

    if grayscale:
        ela = desaturate(ela)

    _, encoded_img = cv.imencode(".jpg", ela)
    base64_img = base64.b64encode(encoded_img).decode("utf-8")
    result_image_dataurl = f"data:image/png;base64,{base64_img}"

    metadata = {
        "processing_time": time.time() - start_time,
        "original_quality": quality,
        "output_scale": scale,
        "contrast": contrast,
        "linear": linear,
        "grayscale": grayscale,
        "image_size": (ela.shape[1], ela.shape[0]),  # (width, height)
        "result_image": result_image_dataurl
    }

    return metadata
