import cv2
import numpy as np

from fastapi import FastAPI, UploadFile, File, HTTPException, Depends, Form
from pydantic import BaseModel,Field
from typing import List
from datetime import datetime
from utility import create_lut, bgr_to_gray3, detect_anti_forensics,read_gif_with_pillow
from PIL import Image


class EchoEdgeFormInput(BaseModel):
    files: List[UploadFile]
    radius: int = Field(..., ge=1, le=15)
    contrast: int = Field(..., ge=0, le=100)
    grayscale: bool = False
    anti_forensics: bool = False  # 新增反取证检测选项

    @classmethod
    def as_form(
        cls,
        files: List[UploadFile] = File(...),
        radius: int = Form(2, ge=1, le=15),
        contrast: int = Form(85, ge=0, le=100),
        grayscale: bool = Form(False),
        anti_forensics: bool = Form(False)  # 新增参数

    ):
        return cls(
            files=files,
            radius=radius,
            contrast=contrast,
            grayscale=grayscale,
            anti_forensics=anti_forensics
        )

class EchoEdgeResult(BaseModel):
    processing_time: float
    image_size: dict
    parameters: dict
    result_image: str
    forensic_warnings: List[str]  # 新增反取证警告字段

def optimized_sobel_edge(
        image: np.ndarray,
        kernel: int = 3,
        contrast_value: int = 200,
        grad_threshold: float = 0.3
) -> np.ndarray:
    """
    优化版的Sobel边缘检测算法
    """
    # 优化1: 使用Scharr算子在小内核下获得更优精度 (3x3内核)
    if kernel == 3:
        sobel_x = cv2.Scharr(image, cv2.CV_64F, 1, 0)
        sobel_y = cv2.Scharr(image, cv2.CV_64F, 0, 1)
    else:
        # 优化2: 对于大内核，使用常规Sobel但添加高斯平滑减小噪声
        blurred = cv2.GaussianBlur(image, (3, 3), 0)
        sobel_x = cv2.Sobel(blurred, cv2.CV_64F, 1, 0, ksize=kernel)
        sobel_y = cv2.Sobel(blurred, cv2.CV_64F, 0, 1, ksize=kernel)
    
    # 优化3: 使用欧式距离的近似计算（提高速度）
    # abs_x = np.abs(sobel_x)
    # abs_y = np.abs(sobel_y)
    # deriv = abs_x * 0.5 + abs_y * 0.5  # 近似计算
    # 精确计算梯度幅值
    deriv = np.sqrt(sobel_x**2 + sobel_y**2)
    
    # 优化4: 基于阈值过滤弱梯度（减少噪声）
    max_val = deriv.max()
    if max_val > 0:
        deriv = np.where(deriv < max_val * grad_threshold, 0, deriv)
    
    # 归一化并应用对比度增强
    deriv_norm = cv2.normalize(deriv, None, 0, 255, cv2.NORM_MINMAX, cv2.CV_8UC1)
    lut = create_lut(0, contrast_value)
    return cv2.LUT(deriv_norm, lut)


async def process_echo_edge(
        image_path: str,
        radius: int = 2,
        contrast: int = 85,
        grayscale: bool = False,
        anti_forensics: bool = False  # 新增参数
) -> dict:
    start_time = datetime.now()

    image = cv2.imread(image_path)
    if image is None:
        return {"error": "Invalid image file"}

    # 20250806-lynn-反取证检测
    forensic_warnings = []
    if anti_forensics:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        forensic_warnings = detect_anti_forensics(gray)
        # 如果检测到模糊处理，自动增强边缘检测强度
        if any("smoothing" in w for w in forensic_warnings):
            contrast = min(contrast + 15, 100)  # 增加对比度

    # Process image
    kernel = 2 * radius + 1
    contrast_value = int(contrast / 100 * 255)
    #lut = create_lut(0, contrast_value)

    # 20250806-lynn-使用优化的Sobel边缘检测替代Laplacian
    processed_channels = []
    for channel in cv2.split(image):
        # 梯度阈值随内核大小调整（大内核需要更高阈值）
        grad_threshold = 0.2 if kernel <= 3 else 0.3
        edge_channel = optimized_sobel_edge(
            channel, 
            kernel=kernel,
            contrast_value=contrast_value,
            grad_threshold=grad_threshold
        )
        processed_channels.append(edge_channel)
    
    result = cv2.merge(processed_channels)
    if grayscale:
        # 优化：对灰度结果也进行反取证感知处理
        if anti_forensics and any("smoothing" in w for w in forensic_warnings):
            result = cv2.addWeighted(result, 1.2, result, 0, 10)  # 增强对比度
        result = bgr_to_gray3(result)
    '''
    注释之前的代码，保存用于回溯
    laplace = []
    for channel in cv2.split(image):
        deriv = np.fabs(cv2.Laplacian(channel, cv2.CV_64F, None, kernel))
        deriv = cv2.normalize(deriv, None, 0, 255, cv2.NORM_MINMAX, cv2.CV_8UC1)
        laplace.append(cv2.LUT(deriv, lut))

    result = cv2.merge(laplace)
    if grayscale:
        result = bgr_to_gray3(result)
    '''
    processing_time = (datetime.now() - start_time).total_seconds()

    # 基础性能指标
    result_info = {
        "output_image": result,
        "processing_time": processing_time,
        "image_size": {"width": image.shape[1], "height": image.shape[0]},
        "parameters": {
            "radius": radius,
            "contrast": contrast,
            "grayscale": grayscale,
            "anti_forensics": anti_forensics  # 记录参数
        },
        "forensic_warnings": forensic_warnings  # 返回警告
    }

    # 图像编码（根据实际API需求实现）
    # _, encoded_img = cv2.imencode('.png', result)
    # result_image = base64.b64encode(encoded_img).decode('utf-8')
    # result_info['result_image'] = result_image
    
    return result_info


def process_echo_edge_no_async(
        image_path: str,
        radius: int = 2,
        contrast: int = 85,
        grayscale: bool = False,
        anti_forensics: bool = False  # 新增参数
) -> dict:
    start_time = datetime.now()

    if image_path.lower().endswith('.gif'):
        # 如果是GIF文件，使用Pillow读取
        image = read_gif_with_pillow(image_path)
        if image is None:
            return {"error": "Invalid GIF file"}
    else:
        # 对于非GIF文件，使用OpenCV读取
        image = cv2.imread(image_path)
        if image is None:
            return {"error": "Invalid image file"}

    # 20250806-lynn-反取证检测
    forensic_warnings = []
    if anti_forensics:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        forensic_warnings = detect_anti_forensics(gray)
        # 如果检测到模糊处理，自动增强边缘检测强度
        if any("smoothing" in w for w in forensic_warnings):
            contrast = min(contrast + 15, 100)  # 增加对比度

    # Process image
    kernel = 2 * radius + 1
    contrast_value = int(contrast / 100 * 255)
    #lut = create_lut(0, contrast_value)

    # 20250806-lynn-使用优化的Sobel边缘检测替代Laplacian
    processed_channels = []
    for channel in cv2.split(image):
        # 梯度阈值随内核大小调整（大内核需要更高阈值）
        grad_threshold = 0.2 if kernel <= 3 else 0.3
        edge_channel = optimized_sobel_edge(
            channel, 
            kernel=kernel,
            contrast_value=contrast_value,
            grad_threshold=grad_threshold
        )
        processed_channels.append(edge_channel)
    
    result = cv2.merge(processed_channels)
    if grayscale:
        # 优化：对灰度结果也进行反取证感知处理
        if anti_forensics and any("smoothing" in w for w in forensic_warnings):
            result = cv2.addWeighted(result, 1.2, result, 0, 10)  # 增强对比度
        result = bgr_to_gray3(result)
    '''
    注释之前的代码，保存用于回溯
    laplace = []
    for channel in cv2.split(image):
        deriv = np.fabs(cv2.Laplacian(channel, cv2.CV_64F, None, kernel))
        deriv = cv2.normalize(deriv, None, 0, 255, cv2.NORM_MINMAX, cv2.CV_8UC1)
        laplace.append(cv2.LUT(deriv, lut))

    result = cv2.merge(laplace)
    if grayscale:
        result = bgr_to_gray3(result)
    '''
    processing_time = (datetime.now() - start_time).total_seconds()

    # 基础性能指标
    result_info = {
        "output_image": result,
        "processing_time": processing_time,
        "image_size": {"width": image.shape[1], "height": image.shape[0]},
        "parameters": {
            "radius": radius,
            "contrast": contrast,
            "grayscale": grayscale,
            "anti_forensics": anti_forensics  # 记录参数
        },
        "forensic_warnings": forensic_warnings  # 返回警告
    }

    # 图像编码（根据实际API需求实现）
    # _, encoded_img = cv2.imencode('.png', result)
    # result_image = base64.b64encode(encoded_img).decode('utf-8')
    # result_info['result_image'] = result_image
    
    return result_info
