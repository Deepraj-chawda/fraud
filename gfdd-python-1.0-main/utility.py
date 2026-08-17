
import sys
from time import time
import os
from PIL import Image
import rawpy
import cv2 as cv
import numpy as np
from typing import List


def pad_image(image, bsize, reflect=False):
    rows, cols = image.shape[:2]
    top = left = 0
    bottom = bsize - rows % bsize
    right = bsize - cols % bsize
    border = cv.BORDER_CONSTANT if not reflect else cv.BORDER_REFLECT_101
    padded = cv.copyMakeBorder(image, top, bottom, left, right, border)
    return padded


def shift_image(image, bsize):
    rows, cols = image.shape[:2]
    shifted = np.zeros_like(image)
    shifted[: rows - bsize, : cols - bsize] = image[bsize:, bsize:]
    return shifted


def human_size(total, binary=False, suffix="B"):
    units = ["", "K", "M", "G", "T", "P", "E", "Z", "Y"]
    if binary:
        units = [unit + "i" for unit in units]
        factor = 1024.0
    else:
        factor = 1000.0
    for unit in units:
        if abs(total) < factor:
            return f"{total:3.1f} {unit}{suffix}"
        total /= factor
    return f"{total:.1f} {units[-1]}{suffix}"


def create_lut(low, high):
    if low >= 0:
        p1 = (+low, 0)
    else:
        p1 = (0, -low)
    if high >= 0:
        p2 = (255 - high, 255)
    else:
        p2 = (255, 255 + high)
    if p1[0] == p2[0]:
        return np.full(256, 255, np.uint8)
    lut = [(x * (p1[1] - p2[1]) + p1[0] * p2[1] - p1[1] * p2[0]) / (p1[0] - p2[0]) for x in range(256)]
    return np.clip(np.array(lut), 0, 255).astype(np.uint8)


def compute_hist(image, normalize=False):
    hist = np.array([h[0] for h in cv.calcHist([image], [0], None, [256], [0, 256])], int)
    return hist / image.size if normalize else hist


def auto_lut(image, centile):
    hist = compute_hist(image, normalize=True)
    if centile == 0:
        nonzero = np.nonzero(hist)[0]
        low = nonzero[0]
        high = nonzero[-1]
    else:
        low_sum = high_sum = 0
        low = 0
        high = 255
        for i, h in enumerate(hist):
            low_sum += h
            if low_sum >= centile:
                low = i
                break
        for i, h in enumerate(np.flip(hist)):
            high_sum += h
            if high_sum >= centile:
                high = i
                break
    return create_lut(low, high)


def elapsed_time(start, ms=True):
    elapsed = time() - start
    if ms:
        return f"{int(np.round(elapsed * 1000))} ms"
    return f"{elapsed:.2f} sec"


def signed_value(value):
    return f"{'+' if value > 0 else ''}{value}"


def equalize_img(image):
    return cv.merge([cv.equalizeHist(c) for c in cv.split(image)])


def norm_img(image):
    return cv.merge([norm_mat(c) for c in cv.split(image)])


def clip_value(value, minv=None, maxv=None):
    if minv is not None:
        value = max(value, minv)
    if maxv is not None:
        value = min(value, maxv)
    return value


def bgr_to_gray3(image):
    return cv.cvtColor(cv.cvtColor(image, cv.COLOR_BGR2GRAY), cv.COLOR_GRAY2BGR)


def gray_to_bgr(image):
    return cv.cvtColor(image, cv.COLOR_GRAY2BGR)

def desaturate(image):
    return cv.cvtColor(cv.cvtColor(image, cv.COLOR_BGR2GRAY), cv.COLOR_GRAY2BGR)


def norm_mat(matrix, to_bgr=False):
    norm = cv.normalize(matrix, None, 0, 255, cv.NORM_MINMAX).astype(np.uint8)
    if not to_bgr:
        return norm
    return cv.cvtColor(norm, cv.COLOR_GRAY2BGR)


def exiftool_exe():
    if sys.platform.startswith("linux"):
        return "pyexiftool/exiftool/linux/exiftool"
    if sys.platform.startswith("win32"):
        return "pyexiftool/exiftool/win/exiftool.exe"
    if sys.platform.startswith("darwin"):
        return "exiftool"
    return "pyexiftool/exiftool/win/exiftool.exe"


def butter_exe():
    if sys.platform.startswith("linux"):
        return "butteraugli/linux/butteraugli"
    if sys.platform.startswith("win32"):
        return None
    if sys.platform.startswith("darwin"):
        return None
    return None


def ssimul_exe():
    if sys.platform.startswith("linux"):
        return "ssimulacra/linux/ssimulacra"
    if sys.platform.startswith("win32"):
        return None
    if sys.platform.startswith("darwin"):
        return None
    return None

# 20250806-lynn-新增
def detect_anti_forensics(gray: np.ndarray) -> List[str]:
    """检测常见的反取证操作"""
    warnings = []
    
    # 1. 检测过度平滑（模糊处理）
    blurred = cv.medianBlur(gray, 3)
    diff = gray.astype(np.float32) - blurred.astype(np.float32)
    noise_variance = np.var(diff)
    if noise_variance < 5:
        warnings.append(f"反取证模糊检测 (噪声方差={noise_variance:.2f})")
    
    # 2. 检测JPEG压缩痕迹（可选）
    if len(gray.shape) == 2:
        laplacian = cv.Laplacian(gray, cv.CV_64F)
        _, stddev = cv.meanStdDev(laplacian)
        if stddev[0] < 1.5:
            warnings.append(f"过度压缩检测 (拉普拉斯标准差={stddev[0]:.2f})")
    
    return warnings

# 20250806-lynn-新增 解析gif
def read_gif_with_pillow(image_path):
    try:
        # 使用Pillow打开GIF文件
        pil_image = Image.open(image_path)
        
        # 如果是动画GIF，可以选择第一帧
        if getattr(pil_image, "is_animated", False):
            pil_image.seek(0)
            
        # 转换为RGB模式（GIF可能是索引颜色）
        pil_image = pil_image.convert("RGB")
        
        # 转换为numpy数组
        numpy_image = np.array(pil_image)
        
        # 转换颜色空间从RGB到BGR（OpenCV使用BGR）
        opencv_image = cv.cvtColor(numpy_image, cv.COLOR_RGB2BGR)
        
        return opencv_image
    except Exception as e:
        print(f"Error reading GIF: {e}")
        return None
