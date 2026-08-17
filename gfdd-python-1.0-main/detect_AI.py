from pydantic import BaseModel
from typing import List, Optional
from transformers import ViTFeatureExtractor, AutoModelForImageClassification, AutoImageProcessor
import torch.nn.functional as F

import os
import torch
from PIL import Image
from PyPDF2 import PdfReader
import tempfile


# Models
class DetectionResult(BaseModel):
    filename: str
    result: str
    human_probability: float
    ai_probability: float

class BatchDetectionResult(BaseModel):
    results: List[DetectionResult]
    total_files: int
    human_count: int
    ai_count: int

class PDFDetectionResult(BaseModel):
    pdf_filename: str
    images: List[DetectionResult]
    human_count: int
    ai_count: int
    total_images: int

# Initialize model (load once at startup)
# 初始化模型（优化缓存逻辑）
MODEL_DIR = "Model/AIorNot"
MODEL_NAME = "dima806/ai_image_detector"  # 改用更可靠的模型
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
    if sorted(id2label.values()) != sorted(["human", "AI-generated"]):
        print(f"⚠️ 意外标签: {id2label}")
    
    return processor, model, id2label

# 全局初始化
image_processor, detection_model, label_map = load_models()

def detect_ai_image(image_path: str):
    """Detect if image is AI-generated or human-made"""

    labels = ["human", "ai"]
    image = Image.open(image_path).convert("RGB")
    #inputs = feature_extractor(image, return_tensors="pt")
    # 关键改进1：使用新版图像处理器
    inputs = image_processor(
        images=image,
        return_tensors="pt",
        padding=True,            # 处理不同尺寸
        resample=Image.BILINEAR  # 保持质量
    )
    # 推理
    with torch.no_grad():
        outputs = detection_model(**inputs)
    
    # 关键改进2：正确提取概率
    logits = outputs.logits
    probs = F.softmax(logits, dim=-1)[0]  # 获取单个样本概率
    
    # 根据模型配置确定标签
    label0_prob = probs[0].item()
    label1_prob = probs[1].item()
    
    # 确定实际含义（不再硬编码）
    if label_map[0] == "real" and label_map[1] == "ai":
        human_prob, ai_prob = label0_prob, label1_prob
        result = "human" if human_prob > 0.75 else "ai"
    else:
        # 适应性处理
        human_prob = probs[detection_model.config.label2id["real"]].item()
        ai_prob = probs[detection_model.config.label2id["ai"]].item()
        result = "human" if human_prob > 0.75 else "ai"

        
    
    return {
        "result": result,
        "human_probability": float(human_prob),
        "ai_probability": float(ai_prob)
    }
    
    '''
    with torch.no_grad():
        outputs = model(**inputs)
        logits = outputs.logits

    prediction = logits.argmax(-1).item()
    label = labels[prediction]
    probabilities = F.softmax(logits, dim=1)
    values = probabilities[0].detach().numpy()

    return {
        "result": label,
        "human_probability": float(values[0]),
        "ai_probability": float(values[1])
    }
    '''

# Add this helper function
def extract_images_from_pdf(pdf_path: str) -> List[str]:
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

    return image_paths, temp_dir
