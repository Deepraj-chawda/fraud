from PyPDF2 import PdfReader
from fastapi import UploadFile, File, Form
from pydantic import BaseModel
from typing import List, Dict
import os
import tempfile

from deepface import DeepFace

# Models
class FaceMatchResult(BaseModel):
    input_file: str
    compare_file: str
    matched: bool
    distance: float
    threshold: float
    result: float

class FolderComparisonResult(BaseModel):
    threshold: float
    total_matches: int
    matches: List[FaceMatchResult]

class FaceCompareInput(BaseModel):
    input_files: List[UploadFile]
    compare_files: List[UploadFile]
    threshold: float

    @classmethod
    def as_form(
        cls,
        input_files: List[UploadFile] = File(...),
        compare_files: List[UploadFile] = File(...),
        threshold: float = Form(30.0),
    ):
        return cls(
            input_files=input_files,
            compare_files=compare_files,
            threshold=threshold
        )


def extract_images_from_pdf_face(pdf_path: str) -> List[str]:
    """Extract images from PDF and return their file paths"""

    temp_dir = tempfile.mkdtemp()
    image_paths = []

    reader = PdfReader(pdf_path)
    for i, page in enumerate(reader.pages):
        for j, image in enumerate(page.images):
            image_filename = f"page_{i}_image_{j}.{image.name.split('.')[-1]}"
            image_path = os.path.join(temp_dir, image_filename)
            with open(image_path, "wb") as fp:
                fp.write(image.data)
            image_paths.append(image_path)

    return image_paths

def compare_faces(image_path1: str, image_path2: str) -> Dict:

    backends = [
      'opencv',
      'ssd',
      'dlib',
      'mtcnn',
      'fastmtcnn',
      'retinaface',
      'mediapipe',
      'yolov8',
      'yunet',
      'centerface',
    ]
    models = [
        "VGG-Face",
        "Facenet",
        "Facenet512",
        "OpenFace",
        "DeepFace",
        "DeepID",
        "ArcFace",
        "Dlib",
        "SFace",
        "GhostFaceNet",
    ]

    try:
        result = DeepFace.verify(img1_path=image_path1, img2_path=image_path2,
                                 model_name=models[7],detector_backend = backends[2])
        return result
    except Exception as e:
        return {"error": str(e)}


def process_single_file(file_path: str) -> List[str]:
    """Process single file (PDF or image) and return image paths"""
    if file_path.lower().endswith('.pdf'):
        return extract_images_from_pdf_face(file_path)
    elif file_path.lower().split('.')[-1] in ['png', 'jpg', 'jpeg', 'tiff', 'tif', 'gif', 'bmp']:
        return [file_path]
    else:
        return []
