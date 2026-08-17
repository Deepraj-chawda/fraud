from utility import norm_mat, norm_img, equalize_img
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends
from fastapi.responses import JSONResponse, FileResponse
from pydantic import BaseModel
from typing import Literal, Dict, Literal, List, Optional, Tuple
import cv2
import numpy as np
from pdf2image import convert_from_path
from pathlib import Path
import os
import tempfile
import base64

Component = Literal["#1","#2","#3"]
Mode = Literal["Distance", "Projection", "Cross Product"]

class PCAResult(BaseModel):
    filename: str
    alert: Optional[int] = 0
    alert_message: List[str]
    pca_data: Dict
    result_image: str  # base64 encoded

class AnalysisResults(BaseModel):
    total_alerts: int
    results: List[PCAResult]
    component: Component
    mode: Mode
    invert: bool
    equalize: bool


class PCAInput(BaseModel):
    component: Component = "#1"
    mode: Mode = "Distance"
    invert: bool = False
    equalize: bool = False

    @classmethod
    def as_form(
        cls,
        component: Component = Form("#1"),
        mode: Mode = Form("Distance"),
        invert: bool = False,
        equalize: bool = False,
    ):
        return cls(component=component, mode=mode, invert=invert, equalize=equalize)


def convert_numpy_types(data):
    """Convert numpy types to native Python types for JSON serialization"""
    if isinstance(data, np.generic):
        return float(data)
    elif isinstance(data, dict):
        return {k: convert_numpy_types(v) for k, v in data.items()}
    elif isinstance(data, (list, tuple)):
        return [convert_numpy_types(item) for item in data]
    return data

def norm_mat(mat, to_bgr=False):
    norm = cv2.normalize(mat, None, 0, 255, cv2.NORM_MINMAX)
    norm = norm.astype(np.uint8)
    return cv2.cvtColor(norm, cv2.COLOR_GRAY2BGR) if to_bgr else norm

def norm_img(img):
    norm = cv2.normalize(img, None, 0, 255, cv2.NORM_MINMAX)
    return norm.astype(np.uint8)

def equalize_img(img):
    img_yuv = cv2.cvtColor(img, cv2.COLOR_BGR2YUV)
    img_yuv[:, :, 0] = cv2.equalizeHist(img_yuv[:, :, 0])
    return cv2.cvtColor(img_yuv, cv2.COLOR_BGR2YUV)

def process_image(img, filename, component, mode, invert, equalize):
    rows, cols, chans = img.shape
    x = np.reshape(img, (rows * cols, chans)).astype(np.float32)
    mu, ev, ew = cv2.PCACompute2(x, np.array([]))
    p = np.reshape(cv2.PCAProject(x, mu, ev), (rows, cols, chans))
    x0 = img.astype(np.float32) - mu
    
    mean_vector = [mu[0, 2], mu[0, 1], mu[0, 0]]  # BGR order
    eigenvectors = [
        [ev[0, 2], ev[0, 1], ev[0, 0]],  # Eigenvector 1 (BGR)
        [ev[1, 2], ev[1, 1], ev[1, 0]],  # Eigenvector 2 (BGR)
        [ev[2, 2], ev[2, 1], ev[2, 0]]  # Eigenvector 3 (BGR)
    ]
    eigenvalues =  [ew[2, 0], ew[1, 0], ew[0, 0]]  # Reversed order
    
    # Prepare all outputs
    outputs = []
    distance_maps = []
    projection_maps = []

    for j, v in enumerate(ev):
        cross = np.cross(x0, v)
        distance = np.linalg.norm(cross, axis=2) / np.linalg.norm(v)
        project = p[:, :, j]
        distance_maps.append(distance)
        projection_maps.append(project)

        outputs.extend([
            norm_mat(distance, to_bgr=True),
            norm_mat(project, to_bgr=True),
            norm_img(cross)
        ])
    
    table_data = {
        "mean_vector": mean_vector,
        "eigenvectors": eigenvectors,
        "eigenvalues": eigenvalues
    }

    # Convert numpy types to native Python types
    table_data = convert_numpy_types(table_data)


    # Select requested output
    if component == "#1":
        comind = 0
    elif component == "#2":
        comind = 1
    elif component == "#3":
        comind = 2
    index = 3 * comind

    if mode == "Distance":
        output = outputs[index]
    elif mode == "Projection":
        output = outputs[index + 1]
    elif mode == "Cross Product":
        output = outputs[index + 2]

    # Apply post-processing
    if invert:
        output = cv2.bitwise_not(output)
    if equalize:
        output = equalize_img(output)

    _, encoded_img = cv2.imencode(".png", output)
    result_image_base64 = base64.b64encode(encoded_img).decode("utf-8")
    result_image_dataurl = f"data:image/png;base64,{result_image_base64}"
    

    # Alert
    alert = 0
    alert_message = []

    # Mean Vector
    if any(v < 0 or v >255 for v in mean_vector):
        alert = 1
        alert_message.append("Signs of possible tampering. ")
    
    # Eigenvector
    for vec in eigenvectors: 
        if np.max(np.abs(vec)) > 0.95 or np.min(np.abs(vec)) < 0.05:
            alert = 1
            alert_message.append("One color channel is overemphasized. ")
        if np.std(vec) > 0.7 or np.std(vec) < 0.1:
            alert = 1
            alert_message.append("There is a high contrast difference. ")
    
    # Eigenvalues
    explained_ratio = eigenvalues / np.sum(eigenvalues)
    if explained_ratio[2] > 0.95 and explained_ratio[1] < 0.03:
        alert = 1
        alert_message.append("Signs of possible tampering. ")

    # Distance Map Anomalies
    dist_map = distance_maps[comind]
    dist_std = np.std(dist_map)
    dist_mean = np.mean(dist_map)

    if dist_std > 20 or dist_mean > 50:
        alert = 1
        alert_message.append("Possible signs that content is fake or altered. ")

    # Projection Map Anomalies
    proj_map = projection_maps[comind]
    proj_std = np.std(proj_map)
    proj_range = np.max(proj_map) - np.min(proj_map)

    if proj_std < 5 or proj_range < 50:
        alert = 1
        alert_message.append("Some parts may be copied and pasted or artificially made. ")

    return PCAResult(
        filename=filename,
        alert = alert,
        alert_message = alert_message,
        pca_data=table_data,
        result_image=result_image_dataurl
    )



def process_pca(uploaded_file: UploadFile, component: str, mode: str, invert: bool = False, equalize: bool = False) -> List[PCAResult]:
    """
    Perform Principal Component Analysis on an image

    Parameters:
    - component: Which principal component to use (0, 1, or 2)
    - mode: Processing mode ("distance", "projection", or "crossprod")
    - invert: Apply bitwise complement to output
    - equalize: Apply histogram equalization
    """
    results = []
    try:
        with tempfile.TemporaryDirectory() as temp_dir:
            filepath = os.path.join(temp_dir, uploaded_file.filename)
            with open(filepath, "wb") as f:
                f.write(uploaded_file.file.read())
                
            # convert to image if it is a pdf
            if filepath.lower().endswith(".pdf"):
                poppler_path = r"C:\Users\marcoleung\Desktop\Fraud Detection Tool\Fraud Document Detector\01_Source_Code\backend_api\poppler-24.08.0\Library\bin"  # Change this
                images = convert_from_path(filepath, poppler_path = poppler_path)
                if not images:
                    raise HTTPException(status_code=400, detail="Unable to convert PDF to image")
                # Perform PCA in each page
                for i, page in enumerate(images):
                    img = cv2.cvtColor(np.array(page), cv2.COLOR_RGB2BGR)
                    result = process_image(img, f"{uploaded_file.filename}_page_{i+1}", component, mode, invert, equalize)
                    results.append(result)
                    
            else:
                # Read the image directly
                img= cv2.imread(filepath, cv2.IMREAD_COLOR)
                if img is None:
                    raise HTTPException(status_code=400, detail="Invalid image file")
                result = process_image(img, uploaded_file.filename, component, mode, invert, equalize)
                
                results.append(result)

            return results
    
    except Exception as e:
        print(f"Error in file: {str(e)}")
        raise HTTPException(status_code = 500, detail = f"Error in file: {str(e)}")
        
    finally: 
        try: os.remove(filepath)
        except: pass
