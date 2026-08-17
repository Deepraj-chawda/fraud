import os
import cv2
import numpy as np
from pathlib import Path
from typing import Literal, List, Dict, Any, Optional
from pdf2image import convert_from_path
from fastapi import UploadFile, File, Form,HTTPException
import base64
from utility import norm_mat, norm_img, equalize_img
from utility import create_lut, bgr_to_gray3, detect_anti_forensics  # 新增反取证检测函数
from pydantic import BaseModel, Field
import fitz
import shutil
from PIL import Image
import torch
import torch.nn.functional as F
from transformers import AutoModelForImageClassification, AutoImageProcessor
from datetime import datetime
from pyexiftool import exiftool
from utility import exiftool_exe

# 常量定义
THRESHOLD = 0.75
MODEL_DIR = "Model/AIorNot"
#MODEL_NAME = "dima806/ai_image_detector"  # 改用更可靠的模型
MODEL_NAME = "Nahrawy/AIorNot"
Component = Literal["#1","#2","#3"]
Mode = Literal["Distance", "Projection", "Cross Product"]
MODE_THRESHOLDS_ = {
    "minimum": {"blue": 0.28, "green": 0.28, "red": 0.28},
    "average": {"blue": 0.30, "green": 0.30, "red": 0.30},
    "maximum": {"blue": 0.38, "green": 0.38, "red": 0.38},
}


def load_models():
    """安全加载模型"""
    try:
        processor = AutoImageProcessor.from_pretrained(MODEL_DIR)
        model = AutoModelForImageClassification.from_pretrained(MODEL_DIR)
        print("✅ 从本地加载模型")
    except Exception as e:
        print(f"⚠️ 本地模型不存在: {e}，下载中...")

        processor = AutoImageProcessor.from_pretrained(MODEL_NAME)
        model = AutoModelForImageClassification.from_pretrained(MODEL_NAME)
        os.makedirs(MODEL_DIR, exist_ok=True)
        processor.save_pretrained(MODEL_DIR)
        model.save_pretrained(MODEL_DIR)
    
    # 验证标签顺序
    id2label = model.config.id2label
    if sorted(id2label.values()) != sorted(["real", "ai"]):
        print(f"⚠️ 意外标签: {id2label}")
    
    return processor, model, id2label

# 全局初始化
image_processor, detection_model, label_map = load_models()

# 输入模型
class CombineInput(BaseModel):
    files: List[UploadFile] = File(...),
    component: Component = "#1"
    mode: Mode = "Distance"
    invert: bool = False
    equalize: bool = False
    inclusive: bool
    radius: int = Field(..., ge=1, le=15)
    contrast: int = Field(..., ge=0, le=100)
    grayscale: bool = False
    anti_forensics: bool = False  # 新增反取证检测选项
    @classmethod
    def as_form(
        cls,
        files: List[UploadFile] = File(...),
        component: Component = Form("#1"),
        mode: Mode = Form("Distance"),
        invert: bool = False,
        equalize: bool = False,
        inclusive: bool = Form(False),
        radius: int = Form(2, ge=1, le=15),
        contrast: int = Form(85, ge=0, le=100),
        grayscale: bool = Form(False),
        anti_forensics: bool = Form(False)  # 新增参数
    ):
        return cls(
            files=files,
            component=component,
            mode=mode,
            invert=invert,
            equalize=equalize,
            inclusive=inclusive,
            radius=radius,
            contrast=contrast,
            grayscale=grayscale,
            anti_forensics=anti_forensics
        )

class CombinPCAResult(BaseModel):
    filename: str
    alert: Optional[int] = 0
    alert_message: List[str]
    pca_data: Dict
    result_image: str  # base64 encoded

class CombinEchoResult(BaseModel):
    filename: str
    processing_time: float
    image_size: Dict
    parameters: Dict
    forensic_warnings: List[str] 
    #result_image: str

class AnalysisResults(BaseModel):
    total_alerts: int
    results: List[CombinPCAResult]
    component: Component
    mode: Mode
    invert: bool
    equalize: bool

class CombinFileAnalysisResult(BaseModel):
    filename: str
    #image: str
    stats: List[Dict]

class CombineImageStatsResponse(BaseModel):
    total_alerts: int
    stats_results: List[CombinFileAnalysisResult]
    alert_images: List[str]
    thresholds_used: Dict[str, Dict[str, float]]

class CombinedResult(BaseModel):
    alertered_filename: List[str]  
    alertered_summary: Dict[str, List[str]]
    total_alerts: int
    pca_results: List[List[CombinPCAResult]]
    stats_results: List[CombinFileAnalysisResult]
    detections: List[List[Dict[str, Any]]]
    echo_results: List[CombinEchoResult]
    component: Component
    mode: Mode
    invert: bool
    equalize: bool
    alert_images: List[str]
    thresholds_used: Dict[str, Dict[str, float]]
    extra_messages: List[Dict[str, Any]]
    total_alerts_fraud: int

# 分析核心逻辑
async def cal_combined_analysis(filepath: str, filename: str, data: CombineInput,modes: List[str],save_alert_images: bool = False,save_dir: Optional[str] = None) -> Dict[str, Any]:
    """
    Perform Principal Component Analysis on an image

    Parameters:
    - component: Which principal component to use (0, 1, or 2)
    - mode: Processing mode ("distance", "projection", or "crossprod")
    - invert: Apply bitwise complement to output
    - equalize: Apply histogram equalization
    """
    alert_pages = set()
    alerts = []
    stats_result = []
    pca_results = []
    detections = []
    echo_results = []
    exif_results = []
    try:
        # 读取文件
        if filepath.lower().endswith(".pdf"):
            #poppler_path = r"C:\Users\marcoleung\Desktop\Fraud Detection Tool\Fraud Document Detector\01_Source_Code\backend_api\poppler-24.08.0\Library\bin"  # Change this
            #images = convert_from_path(filepath, poppler_path = poppler_path)
            #if not images:
            #    raise HTTPException(status_code=400, detail="Unable to convert PDF to image")
            # 开始用PyMuPDF (fitz)  
            doc = fitz.open(filepath)
            for page_num in range(len(doc)):
                page = doc.load_page(page_num)  # 加载页面

                pix = page.get_pixmap(matrix=fitz.Matrix(2.0, 2.0))
                # 转换为NumPy数组 (RGB格式)
                img_array = np.frombuffer(pix.samples, dtype=np.uint8)
                img_rgb = img_array.reshape(pix.height, pix.width, 3)

                # 转换为OpenCV所需的BGR格式
                img = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)
                
                #img = cv2.cvtColor(np.array(page), cv2.COLOR_RGB2BGR)
                pca_result = process_image(img, f"{Path(filename).stem}_page_{page_num+1}", data.component, data.mode, data.invert, data.equalize)
                stats, result = get_pixel_stats(img, modes, data.inclusive)
                # 调用AI检测
                _filename = os.path.splitext(filename)[0] + "_page_" + str(page_num + 1)
                # 使用英文文件名
                base_filename = "page" + str(page_num + 1)
                output_path = os.path.join(save_dir, f"{base_filename}.jpg")
                pix.save(output_path)
                pix = None  # 及时释放内存
                detection = detect_ai_image(output_path, _filename)
                echo_result = process_echo_edge(
                    image_path=output_path,
                    radius=data.radius,
                    contrast=data.contrast,
                    grayscale=data.grayscale,
                    anti_forensics=data.anti_forensics
                )
                # 增加exif，接收返回的三个参数
                exif_result = extract_exif(output_path, _filename)

                for mode in modes:
                    thresholds = MODE_THRESHOLDS_[mode]
                    page_alert_messages = []  # 重置当前页面的警示信息
                    triggered = {}

                    # 处理NaN值
                    for color in ["blue", "green", "red"]:
                        if np.isnan(stats[mode][color]):
                            stats[mode][color] = 0 if mode != "maximum" else 10

                    # === 安全计算total_pixels ===
                    color_values = [stats[mode][color] for color in ["blue", "green", "red"]]
                    total_pixels = sum(color_values)
                    
                    # 当total_pixels为0时的安全处理
                    if total_pixels <= 0:
                        page_alert_messages.append(f"Invalid Pixel Value: total_pixels={total_pixels}")
                        triggered = {color: False for color in ["blue", "green", "red"]}
                    else:
                        # ===== 各模式的颜色比例检测 =====
                        if mode == "minimum":
                            # 检查是否全为0
                            if all(val == 0 for val in color_values):
                                page_alert_messages.append("No Pixel Detected")
                            elif any(stats[mode][color] / total_pixels < thresholds[color] for color in ["blue", "green", "red"]):
                                page_alert_messages.append(" Parts of the image are too dark or missing colors")
                            
                            # 设置颜色触发状态
                            triggered = {
                                color: stats[mode][color] / total_pixels < thresholds[color]
                                for color in ["blue", "green", "red"]
                            }

                        elif mode == "average":
                            triggered = {
                                color: stats[mode][color] / total_pixels < thresholds[color]
                                for color in ["blue", "green", "red"]
                            }
                            if any(triggered.values()):
                                page_alert_messages.append(" Colors differ more than expected")

                        elif mode == "maximum":
                            # 检查是否全为默认值（处理NaN后的情况）
                            if all(val == 10 for val in color_values):
                                page_alert_messages.append("No Pixel Detected")
                            elif any(stats[mode][color] / total_pixels > thresholds[color] for color in ["blue", "green", "red"]):
                                page_alert_messages.append(" One color dominates the image")
                            
                            triggered = {
                                color: stats[mode][color] / total_pixels > thresholds[color]
                                for color in ["blue", "green", "red"]
                            }

                    # ==== 与total_pixels无关的检测 =====
                    # 标准差检测
                    std_dev = stats[mode]["std_dev"]
                    if std_dev < 20:
                        triggered["std_dev"] = True
                        page_alert_messages.append(" The image appears flat without depth")
                    elif 20 <= std_dev < 30:
                        triggered["std_dev"] = True
                        page_alert_messages.append(" The image seems unusually noisy")
                    elif 90 <= std_dev < 100:
                        triggered["std_dev"] = True
                        page_alert_messages.append(" The image might be sharper than normal")
                    elif std_dev >= 100:
                        triggered["std_dev"] = True
                        page_alert_messages.append(" The image is excessively sharp")

                    # 分布峰检测
                    if stats[mode]["distribution_peaks"] > 2:
                        triggered["bimodal_distribution"] = True
                        page_alert_messages.append(" Multiple patterns or changes are detected")

                    # 收集当前模式的警示
                    if page_alert_messages:
                        alert_colors = [color for color, flag in triggered.items() if flag]
                        if alert_colors:
                            alert_pages.add(page_num+1)
                            alerts.append({
                                "mode": mode,
                                "alert_type": alert_colors,
                                "message": page_alert_messages.copy()
                            })
                            # 保存警示图片
                            # Save results if alert triggered
                            if save_alert_images and save_dir:
                                safe_filename = base_filename + ".png"  # 强制PNG格式
                                save_path = os.path.join(save_dir, safe_filename)
                                cv2.imwrite(save_path, result[mode])
                    
                # Construct the result for this page
                page_result = {
                    "filename": f"{Path(filename).stem}_page_{page_num+1}",
                    "alert": 1 if alert_colors else 0,
                    "alerts": alerts.copy() if alerts else [],
                    "stats": stats,
                    "status": "processed" if total_pixels > 0 else "skipped"
                }
                stats_result.append(page_result)
                pca_results.append(pca_result)
                detections.append(detection)
                echo_results.append(echo_result)
                exif_results.append(exif_result)
        else:
            img= cv2.imread(filepath, cv2.IMREAD_COLOR)
            if img is None:
                raise HTTPException(status_code=400, detail="Invalid image file")

            pca_result = process_image(img, filename, data.component, data.mode, data.invert, data.equalize)
            stats, result = get_pixel_stats(img, modes, data.inclusive)
            detection = detect_ai_image(filepath, filename)
            echo_result = process_echo_edge(
                image_path=filepath,
                radius=data.radius,
                contrast=data.contrast,
                grayscale=data.grayscale,
                anti_forensics=data.anti_forensics
            )
            # 增加exif
            exif_result = extract_exif(filepath,filename)
            
            # Trigger Alerts for each mode
            for mode in modes:
                # Trigger Alerts
                # Trigger if any color is too low
                if mode == "minimum":
                    # Initialize a list to collect alert messages for this page
                    page_alert_messages = []
                    thresholds = MODE_THRESHOLDS_[mode]
                    
                    if np.isnan(stats[mode]["blue"]):
                        stats[mode]["blue"] = 0
                    if np.isnan(stats[mode]["green"]):
                        stats[mode]["green"] = 0
                    if np.isnan(stats[mode]["red"]):
                        stats[mode]["red"] = 0
                    total_pixels = (stats[mode]["blue"] + stats[mode]["green"] + stats[mode]["red"])
                    triggered = {
                        color: stats[mode][color] / total_pixels < thresholds[color]
                        for color in ["blue", "green", "red"]
                    }
                    if stats[mode]["blue"] == 0 and stats[mode]["green"] == 0 and stats[mode]["red"] == 0:
                        page_alert_messages.append("No Pixel Detected")
                    elif triggered["blue"] or triggered["green"] or triggered["red"]:
                        page_alert_messages.append(" Parts of the image are too dark or missing colors")
                       
                    
                    # Standard deviation alert is triggered 
                    if stats[mode]["std_dev"] < 20:
                        triggered["std_dev"] = True
                        page_alert_messages.append(" The image appears flat without depth")
                    elif 20 < stats[mode]["std_dev"] < 30:
                        triggered["std_dev"] = True
                        page_alert_messages.append(" The image seems unusually noisy")
                    elif 90 < stats[mode]["std_dev"] < 100:
                        triggered["std_dev"] = True
                        page_alert_messages.append(" The image might be sharper than normal")
                    elif stats[mode]["std_dev"] > 100:
                        triggered["std_dev"] = True
                        page_alert_messages.append(" The image is excessively sharp")

                    if stats[mode]["distribution_peaks"] > 2:
                        triggered["bimodal_distribution"] = True
                        if triggered["bimodal_distribution"]:
                            page_alert_messages.append(" Multiple patterns or changes are detected")
                        
                # Trigger alert is any color has too few pixels
                # Pixels is counted if the channel is close to the average of all three channels
                elif mode == "average":
                    # Initialize a list to collect alert messages for this page
                    page_alert_messages = []
                    thresholds = MODE_THRESHOLDS_[mode]
                    total_pixels = (stats[mode]["blue"] + stats[mode]["green"] + stats[mode]["red"])
                    triggered = {
                        color: stats[mode][color] / total_pixels < thresholds[color]
                        for color in ["blue", "green", "red"]
                    }
                    if triggered["blue"] or triggered["green"] or triggered["red"]:
                        page_alert_messages.append(" Colors differ more than expected")

                    # Standard deviation alert is triggered 
                    if stats[mode]["std_dev"] < 20:
                        triggered["std_dev"] = True
                        page_alert_messages.append(" The image appears flat without depth")
                    elif 20 < stats[mode]["std_dev"] < 30:
                        triggered["std_dev"] = True
                        page_alert_messages.append(" The image seems unusually noisy")
                    elif 90 < stats[mode]["std_dev"] < 100:
                        triggered["std_dev"] = True
                        page_alert_messages.append(" The image might be sharper than normal")
                    elif stats[mode]["std_dev"] > 100:
                        triggered["std_dev"] = True
                        page_alert_messages.append(" The image is excessively sharp")

                    if stats[mode]["distribution_peaks"] > 2:
                        triggered["bimodal_distribution"] = True
                        if triggered["bimodal_distribution"]:
                            page_alert_messages.append(" Multiple patterns or changes are detected")

                # Trigger alert is any color is too high
                # Pixels is counted if the channel is highest among all three channels
                elif mode == "maximum":
                    # Initialize a list to collect alert messages for this page
                    page_alert_messages = []
                    thresholds = MODE_THRESHOLDS_[mode]
                    if np.isnan(stats[mode]["blue"]):
                        stats[mode]["blue"] = 10
                    if np.isnan(stats[mode]["green"]):
                        stats[mode]["green"] = 10
                    if np.isnan(stats[mode]["red"]):
                        stats[mode]["red"] = 10
                    total_pixels = (stats[mode]["blue"] + stats[mode]["green"] + stats[mode]["red"])
                    triggered = {
                        color: stats[mode][color] / total_pixels > thresholds[color]
                        for color in ["blue", "green", "red"]
                    }
                    if stats[mode]["blue"] == 10 and stats[mode]["green"] == 10 and stats[mode]["red"] == 10:
                        page_alert_messages.append("No Pixel Detected")                    
                    elif triggered["blue"] or triggered["green"] or triggered["red"]:
                        page_alert_messages.append(" One color dominates the image")

                    # Standard deviation alert is triggered 
                    if stats[mode]["std_dev"] < 20:
                        triggered["std_dev"] = True
                        page_alert_messages.append(" The image appears flat without depth")
                    elif 20 < stats[mode]["std_dev"] < 30:
                        triggered["std_dev"] = True
                        page_alert_messages.append(" The image seems unusually noisy")
                    elif 90 < stats[mode]["std_dev"] < 100:
                        triggered["std_dev"] = True
                        page_alert_messages.append(" The image might be sharper than normal")
                    elif stats[mode]["std_dev"] > 100:
                        triggered["std_dev"] = True
                        page_alert_messages.append(" The image is excessively sharp")

                    if stats[mode]["distribution_peaks"] > 2:
                        triggered["bimodal_distribution"] = True
                        if triggered["bimodal_distribution"]:
                            page_alert_messages.append(" Multiple patterns or changes are detected")
                else:
                    raise ValueError("Invalid mode")  

                alert_colors = [color for color, flag in triggered.items() if flag]
                if alert_colors:
                    alert_pages.add(1)
                    alerts.append({
                        "mode": mode,
                        "alert_type": alert_colors,
                        "message": page_alert_messages.copy()
                    })

                    # Save results if alert triggered
                    if save_alert_images and save_dir:
                        filename = filename
                        save_path = os.path.join(save_dir, filename)
                        cv2.imwrite(save_path, result[mode])
                
            # Construct the result for this image
            image_result = {
                "filename": filename,
                "alert": 1 if alert_colors else 0,
                "alerts": alerts.copy() if alerts else None,
                "stats": stats,
            }
            stats_result.append(image_result)
            pca_results.append(pca_result)
            detections.append(detection)
            echo_results.append(echo_result)
            exif_results.append(exif_result)
        return stats_result, pca_results, len(alert_pages), MODE_THRESHOLDS_, detections, echo_results, exif_results
        
    except Exception as e:
        print(f"Error in file: {str(e)}")
        raise HTTPException(status_code = 500, detail = f"Error in file: {str(e)}")
        
    finally: 
        try: shutil.rmtree(filepath, ignore_errors=True)
        except: pass

def cal_combined_analysis_no_async(filepath: str, filename: str, data: CombineInput,modes: List[str],save_alert_images: bool = False,save_dir: Optional[str] = None) -> Dict[str, Any]:
    """
    Perform Principal Component Analysis on an image

    Parameters:
    - component: Which principal component to use (0, 1, or 2)
    - mode: Processing mode ("distance", "projection", or "crossprod")
    - invert: Apply bitwise complement to output
    - equalize: Apply histogram equalization
    """
    alert_pages = set()
    alerts = []
    stats_result = []
    pca_results = []
    detections = []
    echo_results = []
    exif_results = []

    try:
        # 读取文件
        if filepath.lower().endswith(".pdf"):
            #poppler_path = r"C:\Users\marcoleung\Desktop\Fraud Detection Tool\Fraud Document Detector\01_Source_Code\backend_api\poppler-24.08.0\Library\bin"  # Change this
            #images = convert_from_path(filepath, poppler_path = poppler_path)
            #if not images:
            #    raise HTTPException(status_code=400, detail="Unable to convert PDF to image")
            # 开始用PyMuPDF (fitz)  
            doc = fitz.open(filepath)
            for page_num in range(len(doc)):
                page = doc.load_page(page_num)  # 加载页面

                pix = page.get_pixmap(matrix=fitz.Matrix(2.0, 2.0))
                # 转换为NumPy数组 (RGB格式)
                img_array = np.frombuffer(pix.samples, dtype=np.uint8)
                img_rgb = img_array.reshape(pix.height, pix.width, 3)

                # 转换为OpenCV所需的BGR格式
                img = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)
                
                #img = cv2.cvtColor(np.array(page), cv2.COLOR_RGB2BGR)
                pca_result = process_image(img, f"{Path(filename).stem}_page_{page_num+1}", data.component, data.mode, data.invert, data.equalize)
                stats, result = get_pixel_stats(img, modes, data.inclusive)
                # 调用AI检测
                _filename = os.path.splitext(filename)[0] + "_page_" + str(page_num + 1)
                # 使用英文文件名
                base_filename = "page" + str(page_num + 1)
                output_path = os.path.join(save_dir, f"{base_filename}.jpg")
                pix.save(output_path)
                pix = None  # 及时释放内存
                detection = detect_ai_image(output_path, _filename)
                echo_result = process_echo_edge(
                    image_path=output_path,
                    radius=data.radius,
                    contrast=data.contrast,
                    grayscale=data.grayscale,
                    anti_forensics=data.anti_forensics
                )
                # 增加exif，接收返回的三个参数
                exif_result = extract_exif(output_path, _filename)

                for mode in modes:
                    thresholds = MODE_THRESHOLDS_[mode]
                    page_alert_messages = []  # 重置当前页面的警示信息
                    triggered = {}

                    # 处理NaN值
                    for color in ["blue", "green", "red"]:
                        if np.isnan(stats[mode][color]):
                            stats[mode][color] = 0 if mode != "maximum" else 10

                    # === 安全计算total_pixels ===
                    color_values = [stats[mode][color] for color in ["blue", "green", "red"]]
                    total_pixels = sum(color_values)
                    
                    # 当total_pixels为0时的安全处理
                    if total_pixels <= 0:
                        page_alert_messages.append(f"Invalid Pixel Value: total_pixels={total_pixels}")
                        triggered = {color: False for color in ["blue", "green", "red"]}
                    else:
                        # ===== 各模式的颜色比例检测 =====
                        if mode == "minimum":
                            # 检查是否全为0
                            if all(val == 0 for val in color_values):
                                page_alert_messages.append("No Pixel Detected")
                            elif any(stats[mode][color] / total_pixels < thresholds[color] for color in ["blue", "green", "red"]):
                                page_alert_messages.append(" Parts of the image are too dark or missing colors")
                            
                            # 设置颜色触发状态
                            triggered = {
                                color: stats[mode][color] / total_pixels < thresholds[color]
                                for color in ["blue", "green", "red"]
                            }

                        elif mode == "average":
                            triggered = {
                                color: stats[mode][color] / total_pixels < thresholds[color]
                                for color in ["blue", "green", "red"]
                            }
                            if any(triggered.values()):
                                page_alert_messages.append(" Colors differ more than expected")

                        elif mode == "maximum":
                            # 检查是否全为默认值（处理NaN后的情况）
                            if all(val == 10 for val in color_values):
                                page_alert_messages.append("No Pixel Detected")
                            elif any(stats[mode][color] / total_pixels > thresholds[color] for color in ["blue", "green", "red"]):
                                page_alert_messages.append(" One color dominates the image")
                            
                            triggered = {
                                color: stats[mode][color] / total_pixels > thresholds[color]
                                for color in ["blue", "green", "red"]
                            }

                    # ==== 与total_pixels无关的检测 =====
                    # 标准差检测
                    std_dev = stats[mode]["std_dev"]
                    if std_dev < 20:
                        triggered["std_dev"] = True
                        page_alert_messages.append(" The image appears flat without depth")
                    elif 20 <= std_dev < 30:
                        triggered["std_dev"] = True
                        page_alert_messages.append(" The image seems unusually noisy")
                    elif 90 <= std_dev < 100:
                        triggered["std_dev"] = True
                        page_alert_messages.append(" The image might be sharper than normal")
                    elif std_dev >= 100:
                        triggered["std_dev"] = True
                        page_alert_messages.append(" The image is excessively sharp")

                    # 分布峰检测
                    if stats[mode]["distribution_peaks"] > 2:
                        triggered["bimodal_distribution"] = True
                        page_alert_messages.append(" Multiple patterns or changes are detected")

                    # 收集当前模式的警示
                    if page_alert_messages:
                        alert_colors = [color for color, flag in triggered.items() if flag]
                        if alert_colors:
                            alert_pages.add(page_num+1)
                            alerts.append({
                                "mode": mode,
                                "alert_type": alert_colors,
                                "message": page_alert_messages.copy()
                            })
                            # 保存警示图片
                            # Save results if alert triggered
                            if save_alert_images and save_dir:
                                safe_filename = base_filename + ".png"  # 强制PNG格式
                                save_path = os.path.join(save_dir, safe_filename)
                                cv2.imwrite(save_path, result[mode])
                    
                # Construct the result for this page
                page_result = {
                    "filename": f"{Path(filename).stem}_page_{page_num+1}",
                    "alert": 1 if alert_colors else 0,
                    "alerts": alerts.copy() if alerts else [],
                    "stats": stats,
                    "status": "processed" if total_pixels > 0 else "skipped"
                }
                stats_result.append(page_result)
                pca_results.append(pca_result)
                detections.append(detection)
                echo_results.append(echo_result)
                exif_results.append(exif_result)
        else:
            img= cv2.imread(filepath, cv2.IMREAD_COLOR)
            if img is None:
                raise HTTPException(status_code=400, detail="Invalid image file")

            pca_result = process_image(img, filename, data.component, data.mode, data.invert, data.equalize)

            stats, result = get_pixel_stats(img, modes, data.inclusive)

            detection = detect_ai_image(filepath, filename)

            echo_result = process_echo_edge(
                image_path=filepath,
                radius=data.radius,
                contrast=data.contrast,
                grayscale=data.grayscale,
                anti_forensics=data.anti_forensics
            )

            # 增加exif
            exif_result = extract_exif(filepath,filename)

            # Trigger Alerts for each mode
            for mode in modes:
                # Trigger Alerts
                # Trigger if any color is too low
                if mode == "minimum":
                    # Initialize a list to collect alert messages for this page
                    page_alert_messages = []
                    thresholds = MODE_THRESHOLDS_[mode]
                    
                    if np.isnan(stats[mode]["blue"]):
                        stats[mode]["blue"] = 0
                    if np.isnan(stats[mode]["green"]):
                        stats[mode]["green"] = 0
                    if np.isnan(stats[mode]["red"]):
                        stats[mode]["red"] = 0
                    total_pixels = (stats[mode]["blue"] + stats[mode]["green"] + stats[mode]["red"])
                    triggered = {
                        color: stats[mode][color] / total_pixels < thresholds[color]
                        for color in ["blue", "green", "red"]
                    }
                    if stats[mode]["blue"] == 0 and stats[mode]["green"] == 0 and stats[mode]["red"] == 0:
                        page_alert_messages.append("No Pixel Detected")
                    elif triggered["blue"] or triggered["green"] or triggered["red"]:
                        page_alert_messages.append(" Parts of the image are too dark or missing colors")
                       
                    
                    # Standard deviation alert is triggered 
                    if stats[mode]["std_dev"] < 20:
                        triggered["std_dev"] = True
                        page_alert_messages.append(" The image appears flat without depth")
                    elif 20 < stats[mode]["std_dev"] < 30:
                        triggered["std_dev"] = True
                        page_alert_messages.append(" The image seems unusually noisy")
                    elif 90 < stats[mode]["std_dev"] < 100:
                        triggered["std_dev"] = True
                        page_alert_messages.append(" The image might be sharper than normal")
                    elif stats[mode]["std_dev"] > 100:
                        triggered["std_dev"] = True
                        page_alert_messages.append(" The image is excessively sharp")

                    if stats[mode]["distribution_peaks"] > 2:
                        triggered["bimodal_distribution"] = True
                        if triggered["bimodal_distribution"]:
                            page_alert_messages.append(" Multiple patterns or changes are detected")
                        
                # Trigger alert is any color has too few pixels
                # Pixels is counted if the channel is close to the average of all three channels
                elif mode == "average":
                    # Initialize a list to collect alert messages for this page
                    page_alert_messages = []
                    thresholds = MODE_THRESHOLDS_[mode]
                    total_pixels = (stats[mode]["blue"] + stats[mode]["green"] + stats[mode]["red"])
                    triggered = {
                        color: stats[mode][color] / total_pixels < thresholds[color]
                        for color in ["blue", "green", "red"]
                    }
                    if triggered["blue"] or triggered["green"] or triggered["red"]:
                        page_alert_messages.append(" Colors differ more than expected")

                    # Standard deviation alert is triggered 
                    if stats[mode]["std_dev"] < 20:
                        triggered["std_dev"] = True
                        page_alert_messages.append(" The image appears flat without depth")
                    elif 20 < stats[mode]["std_dev"] < 30:
                        triggered["std_dev"] = True
                        page_alert_messages.append(" The image seems unusually noisy")
                    elif 90 < stats[mode]["std_dev"] < 100:
                        triggered["std_dev"] = True
                        page_alert_messages.append(" The image might be sharper than normal")
                    elif stats[mode]["std_dev"] > 100:
                        triggered["std_dev"] = True
                        page_alert_messages.append(" The image is excessively sharp")

                    if stats[mode]["distribution_peaks"] > 2:
                        triggered["bimodal_distribution"] = True
                        if triggered["bimodal_distribution"]:
                            page_alert_messages.append(" Multiple patterns or changes are detected")

                # Trigger alert is any color is too high
                # Pixels is counted if the channel is highest among all three channels
                elif mode == "maximum":
                    # Initialize a list to collect alert messages for this page
                    page_alert_messages = []
                    thresholds = MODE_THRESHOLDS_[mode]
                    if np.isnan(stats[mode]["blue"]):
                        stats[mode]["blue"] = 10
                    if np.isnan(stats[mode]["green"]):
                        stats[mode]["green"] = 10
                    if np.isnan(stats[mode]["red"]):
                        stats[mode]["red"] = 10
                    total_pixels = (stats[mode]["blue"] + stats[mode]["green"] + stats[mode]["red"])
                    triggered = {
                        color: stats[mode][color] / total_pixels > thresholds[color]
                        for color in ["blue", "green", "red"]
                    }
                    if stats[mode]["blue"] == 10 and stats[mode]["green"] == 10 and stats[mode]["red"] == 10:
                        page_alert_messages.append("No Pixel Detected")                    
                    elif triggered["blue"] or triggered["green"] or triggered["red"]:
                        page_alert_messages.append(" One color dominates the image")

                    # Standard deviation alert is triggered 
                    if stats[mode]["std_dev"] < 20:
                        triggered["std_dev"] = True
                        page_alert_messages.append(" The image appears flat without depth")
                    elif 20 < stats[mode]["std_dev"] < 30:
                        triggered["std_dev"] = True
                        page_alert_messages.append(" The image seems unusually noisy")
                    elif 90 < stats[mode]["std_dev"] < 100:
                        triggered["std_dev"] = True
                        page_alert_messages.append(" The image might be sharper than normal")
                    elif stats[mode]["std_dev"] > 100:
                        triggered["std_dev"] = True
                        page_alert_messages.append(" The image is excessively sharp")

                    if stats[mode]["distribution_peaks"] > 2:
                        triggered["bimodal_distribution"] = True
                        if triggered["bimodal_distribution"]:
                            page_alert_messages.append(" Multiple patterns or changes are detected")
                else:
                    raise ValueError("Invalid mode")  

                alert_colors = [color for color, flag in triggered.items() if flag]
                if alert_colors:
                    alert_pages.add(1)
                    alerts.append({
                        "mode": mode,
                        "alert_type": alert_colors,
                        "message": page_alert_messages.copy()
                    })

                    # Save results if alert triggered
                    if save_alert_images and save_dir:
                        filename = filename
                        save_path = os.path.join(save_dir, filename)
                        cv2.imwrite(save_path, result[mode])
                
            # Construct the result for this image
            image_result = {
                "filename": filename,
                "alert": 1 if alert_colors else 0,
                "alerts": alerts.copy() if alerts else None,
                "stats": stats,
            }
            stats_result.append(image_result)
            pca_results.append(pca_result)
            detections.append(detection)
            echo_results.append(echo_result)
            exif_results.append(exif_result)
        return stats_result, pca_results, len(alert_pages), MODE_THRESHOLDS_, detections, echo_results, exif_results
        
    except Exception as e:
        print(f"Error in file: {str(e)}")
        raise HTTPException(status_code = 500, detail = f"Error in file: {str(e)}")
        
    finally: 
        try: shutil.rmtree(filepath, ignore_errors=True)
        except: pass
          
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
        alert_message.append(" The color balance seems off, check for edits")
    
    # Eigenvector
    for vec in eigenvectors: 
        if np.max(np.abs(vec)) > 0.95 or np.min(np.abs(vec)) < 0.05:
            alert = 1
            alert_message.append(" One color channel is overemphasized")
        if np.std(vec) > 0.7 or np.std(vec) < 0.1:
            alert = 1
            alert_message.append(" There is a high contrast difference")
    
    # Eigenvalues
    explained_ratio = eigenvalues / np.sum(eigenvalues)
    if explained_ratio[2] > 0.95 and explained_ratio[1] < 0.03:
        alert = 1
        alert_message.append(" Unusual data pattern detected, possible tampering")

    # Distance Map Anomalies
    dist_map = distance_maps[comind]
    dist_std = np.std(dist_map)
    dist_mean = np.mean(dist_map)

    if dist_std > 20 or dist_mean > 50:
        alert = 1
        alert_message.append(" Possible signs that content is fake or altered")

    # Projection Map Anomalies
    proj_map = projection_maps[comind]
    proj_std = np.std(proj_map)
    proj_range = np.max(proj_map) - np.min(proj_map)

    if proj_std < 5 or proj_range < 50:
        alert = 1
        alert_message.append(" Some parts may be copied and pasted or artificially made")

    return CombinPCAResult(
        filename=filename,
        alert=alert,
        alert_message=alert_message,
        pca_data=table_data,
        result_image=result_image_dataurl
    )

def equalize_img(img):
    img_yuv = cv2.cvtColor(img, cv2.COLOR_BGR2YUV)
    img_yuv[:, :, 0] = cv2.equalizeHist(img_yuv[:, :, 0])
    return cv2.cvtColor(img_yuv, cv2.COLOR_BGR2YUV)
def convert_numpy_types(data):
    """Convert numpy types to native Python types for JSON serialization"""
    if isinstance(data, np.generic):
        return float(data)
    elif isinstance(data, dict):
        return {k: convert_numpy_types(v) for k, v in data.items()}
    elif isinstance(data, (list, tuple)):
        return [convert_numpy_types(item) for item in data]
    return data



def get_pixel_stats(img, modes: List[str], inclusive: bool) -> tuple[Dict[str, int], Dict[str, np.ndarray]]:
    """
    Calculate pixel statistics for multiple modes and return results for each mode.
    
    Args:
        img: Input image.
        modes: List of modes to analyze ("minimum", "maximum", "average").
        inclusive: Whether to include equality in comparisons.
        
    Returns:
        Tuple containing:
        - Dictionary of statistics for each mode.
        - Dictionary of result images for each mode.
    """
        
    b, g, r = cv2.split(img)
    results = {}
    stats = {}

    # Create masks based for all three modes:
    for mode in modes:
        stats[mode] = {"blue": 0, "green": 0, "red": 0}
        results[mode] = np.zeros_like(img)
        if mode == "minimum":
            mask_b = np.logical_and(b <= g, b <= r) if inclusive else np.logical_and(b < g, b < r)
            mask_g = np.logical_and(g <= r, g <= b) if inclusive else np.logical_and(g < r, g < b)
            mask_r = np.logical_and(r <= b, r <= g) if inclusive else np.logical_and(r < b, r < g)
        elif mode == "maximum":
            mask_b = np.logical_and(b >= g, b >= r) if inclusive else np.logical_and(b > g, b > r)
            mask_g = np.logical_and(g >= r, g >= b) if inclusive else np.logical_and(g > r, g > b)
            mask_r = np.logical_and(r >= b, r >= g) if inclusive else np.logical_and(r > b, r > g)
        elif mode == "average":
            mean = (b.astype(int) + g.astype(int) + r.astype(int)) / 3
            if inclusive:
                mask_b = b.astype(int) == mean
                mask_g = g.astype(int) == mean
                mask_r = r.astype(int) == mean
            else:
                mask_b = np.abs(b.astype(int) - mean) < 5
                mask_g = np.abs(g.astype(int) - mean) < 5
                mask_r = np.abs(r.astype(int) - mean) < 5
        else:
            raise ValueError("Invalid mode")
        
        # Apply masks
        results[mode][mask_b] = [255, 0, 0]
        results[mode][mask_g] = [0, 255, 0]
        results[mode][mask_r] = [0, 0, 255]

        # Calculate stats
        stats[mode]["blue"] = int(np.sum(mask_b))
        stats[mode]["green"] = int(np.sum(mask_g))
        stats[mode]["red"] = int(np.sum(mask_r))

        # Add Normalized Ratio
        # Only consider relevant pixels
        #combined_mask = mask_b | mask_g | mask_r
        #masked_r = r[combined_mask].astype(np.float32)
        #masked_g = g[combined_mask].astype(np.float32)
        #masked_b = b[combined_mask].astype(np.float32)
        
        #sum_channels = masked_r + masked_g + masked_b
        #sum_channels[sum_channels == 0] = 1 # avoid no relevant pixels

        # Normalized Ratios
        #norm_r = masked_r / sum_channels
        #norm_g = masked_g / sum_channels
        #norm_b = masked_b / sum_channels

        
        #stats[mode]["blue"] = round(float(np.mean(norm_b)), 4) 
        #stats[mode]["green"] = round(float(np.mean(norm_g)), 4)
        #stats[mode]["red"] = round(float(np.mean(norm_r)), 4)

        # Calculate standard deviation
        stats[mode]["std_dev"] = np.std([b, g, r]) 
        # Calculate distribution (simplified check for bimodal)
        hist = cv2.calcHist([img], [0], None, [256], [0, 256])
        hist = hist.astype('float')
        hist /= hist.sum()
        peaks = np.where(hist > 0.02)[0]
        stats[mode]["distribution_peaks"] = len(peaks)

    return stats, results


def extract_exif(filepath, filename: str) -> dict:
    """
    提取图片文件的创建日期、修改日期和创建工具信息
    参数:
        filepath: 图片文件路径
    返回:
        tuple: (创建日期, 修改日期, 创建工具)
    """

    alert_message = []

    with exiftool.ExifTool(exiftool_exe()) as et:
        metadata = et.get_metadata(filepath)

        # Update Metadata extraction
        created = metadata.get('File:FileCreateDate') or metadata.get('File:FileCreatedDate') or metadata.get('EXIF:CreateDate') or metadata.get('QuickTime:CreationDate')
        filename = filename
        modified = metadata.get('File:FileModifyDate') or metadata.get('File:FileModifiedDate') or metadata.get('EXIF:ModifyDate') or metadata.get('QuickTime:ModifyDate')
        tool = metadata.get('File:CreateTool') or metadata.get('EXIF:Software') or 'Unknown'
        
        # 时间校验逻辑
        if created and modified:
            try:
                # 尝试解析日期时间字符串
                from dateutil.parser import parse
                created_time = parse(created)
                modified_time = parse(modified)
                
                if modified_time > created_time:
                    alert_message.append("The last edit date is after when it was created.")
            except (ValueError, AttributeError):
                alert_message.append("Date parsing error.")
        if tool != 'Unknown':
            alert_message.append("Editing software was detected.")
        return {
            "created": created,
            "modified": modified,
            "tool": tool,
            "alert_message": alert_message,
            "filename": filename
        }
# 核心检测函数
def detect_ai_image(image_path: str, filename: str):
    # 图像预处理
    image = Image.open(image_path).convert("RGB")
    
    # 模型推理
    inputs = image_processor(images=image, return_tensors="pt")
    with torch.no_grad():
        outputs = detection_model(**inputs)
    
    # 概率解析
    probs = F.softmax(outputs.logits, dim=-1)[0]
    real_prob = probs[detection_model.config.label2id["real"]].item()
    ai_prob = probs[detection_model.config.label2id["ai"]].item()
    
    # 阈值判定
    alert, result = determine_alert_level(real_prob, ai_prob)
    
    # 警报消息
    alert_msg = generate_alert_message(alert, ai_prob)
    
    return {
        "filename": filename,
        "result": result,
        "real_prob": float(real_prob),
        "ai_prob": float(ai_prob),
        "alert":alert,
        "alert_message":alert_msg
    }

    '''
    return DetectionResult(
        filename=image_path,
        result=result,
        real_prob=real_prob,
        ai_prob=ai_prob,
        alert=alert,
        alert_message=alert_msg
    )
    '''

# 辅助函数
def determine_alert_level(real_prob: float, ai_prob: float) -> tuple:
    if real_prob < THRESHOLD:
        return 1, "AI"
    else:
        return 0, "real"

def generate_alert_message(alert: int, ai_prob: float) -> str:
    if alert == 0:
        return "No alert"
    return f"{ai_prob*100:.2f}% likelihood that the image was created by AI"

def process_echo_edge(
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
