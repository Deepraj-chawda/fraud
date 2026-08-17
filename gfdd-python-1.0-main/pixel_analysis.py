import os
from fastapi import UploadFile, File, Form,HTTPException
from fastapi.responses import JSONResponse, FileResponse
from typing import Tuple, Dict, Literal, List, Optional
from pydantic import BaseModel
import tempfile
import cv2
import numpy as np
from pdf2image import convert_from_path
from pathlib import Path
import fitz
import tempfile
from PIL import Image

ModeType = Literal["minimum", "average", "maximum"]
MODE_THRESHOLDS = {
    "minimum": {"blue": 0.28, "green": 0.28, "red": 0.28},
    "average": {"blue": 0.30, "green": 0.30, "red": 0.30},
    "maximum": {"blue": 0.38, "green": 0.38, "red": 0.38},
}

class ImageStatsInput(BaseModel):
    inclusive: bool
    @classmethod
    def as_form(
        cls,
        inclusive: bool = Form(False)
    ):
        return cls(inclusive=inclusive)
class FileAnalysisResult(BaseModel):
    filename: str
    #image: str
    stats: List[Dict]

class ImageStatsResponse(BaseModel):
    total_alerts: int
    results: List[FileAnalysisResult]
    alert_images: List[str]
    thresholds_used: Dict[str, Dict[str, float]]

# Calculate Pixel Stats
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

# Generate Alerts if Pixel reached threshold
def compute_pixel_stats(uploaded_file: UploadFile, modes: List[str], inclusive: bool, save_alert_images: bool = False, save_dir: Optional[str] = None) -> Tuple[List[Dict], int, Dict[str, Dict[str, float]]]:
    """
    Calculate RGB channel statistics for an image and generate alerts if threshold breached
    
    Args:
        uploaded_file: Uploaded file to process.
        modes: List of modes to analyze ("minimum", "maximum", "average").
        inclusive: Whether to include equality in comparisons.
        save_alert_images: Flag to save images with alerts.
        save_dir: Directory to save alert images.
        
    Returns:
        Tuple containing:
        - List of statistics and alerts for each page.
        - Total number of pages with alerts.
        - Dictionary of mode thresholds.

    """
    alerts = []
    stats_result = []
    alert_pages = set()
    temp_dir = tempfile.mkdtemp()
    filename = uploaded_file.filename or "uploaded_file"
    filepath = os.path.join(temp_dir, filename)
    file_bytes = uploaded_file.file.read()
    alert_message = []

    with open(filepath, "wb") as f:
        f.write(file_bytes)

    try: 
        # convert to image if it is a pdf
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
                stats, result = get_pixel_stats(img, modes, inclusive)

                for mode in modes:
                    # Trigger Alerts
                    # Trigger if any color is too low
                    if mode == "minimum":
                        # Initialize a list to collect alert messages for this page
                        page_alert_messages = []
                        thresholds = MODE_THRESHOLDS[mode]

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
                            page_alert_messages.append("Parts of the image are too dark or missing colors. ")
                        
                        # Standard deviation alert is triggered is std < 20
                        if stats[mode]["std_dev"] < 20:
                            triggered["std_dev"] = True
                            page_alert_messages.append("The image appears flat without depth. ")
                        elif 20 < stats[mode]["std_dev"] < 30:
                            triggered["std_dev"] = True
                            page_alert_messages.append("The image seems unusually noisy. ")
                        elif 90 < stats[mode]["std_dev"] < 100:
                            triggered["std_dev"] = True
                            page_alert_messages.append("The image might be sharper than normal. ")
                        elif stats[mode]["std_dev"] > 100:
                            triggered["std_dev"] = True
                            page_alert_messages.append("The image is excessively sharp. ")

                        if stats[mode]["distribution_peaks"] > 2:
                            triggered["bimodal_distribution"] = True
                            if triggered["bimodal_distribution"]:
                                page_alert_messages.append("Multiple patterns or changes are detected. ")

                    # Trigger alert is any color deviate too far from 0.33
                    elif mode == "average":
                        # Initialize a list to collect alert messages for this page
                        page_alert_messages = []
                        thresholds = MODE_THRESHOLDS[mode]
                        total_pixels = (stats[mode]["blue"] + stats[mode]["green"] + stats[mode]["red"])
                        triggered = {
                            color: stats[mode][color] / total_pixels < thresholds[color]
                            for color in ["blue", "green", "red"]
                        }
                        if triggered["blue"] or triggered["green"] or triggered["red"]:
                            page_alert_messages.append("Colors differ more than expected. ")

                        # Standard deviation alert is triggered 
                        if stats[mode]["std_dev"] < 20:
                            triggered["std_dev"] = True
                            page_alert_messages.append("The image appears flat without depth. ")
                        elif 20 < stats[mode]["std_dev"] < 30:
                            triggered["std_dev"] = True
                            page_alert_messages.append("The image seems unusually noisy. ")
                        elif 90 < stats[mode]["std_dev"] < 100:
                            triggered["std_dev"] = True
                            page_alert_messages.append("The image might be sharper than normal. ")
                        elif stats[mode]["std_dev"] > 100:
                            triggered["std_dev"] = True
                            page_alert_messages.append("The image is excessively sharp. ")

                        if stats[mode]["distribution_peaks"] > 2:
                            triggered["bimodal_distribution"] = True
                            if triggered["bimodal_distribution"]:
                                page_alert_messages.append("Multiple patterns or changes are detected. ")

                    # Trigger alert is any color is too high
                    elif mode == "maximum":
                        # Initialize a list to collect alert messages for this page
                        page_alert_messages = []
                        thresholds = MODE_THRESHOLDS[mode]
                        
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
                            page_alert_messages.append("One color dominates the image. ")

                        # Standard deviation alert is triggered 
                        if stats[mode]["std_dev"] < 20:
                            triggered["std_dev"] = True
                            page_alert_messages.append("The image appears flat without depth. ")
                        elif 20 < stats[mode]["std_dev"] < 30:
                            triggered["std_dev"] = True
                            page_alert_messages.append("The image seems unusually noisy. ")
                        elif 90 < stats[mode]["std_dev"] < 100:
                            triggered["std_dev"] = True
                            page_alert_messages.append("The image might be sharper than normal. ")
                        elif stats[mode]["std_dev"] > 100:
                            triggered["std_dev"] = True
                            page_alert_messages.append("The image is excessively sharp. ")

                        if stats[mode]["distribution_peaks"] > 2:
                            triggered["bimodal_distribution"] = True
                            if triggered["bimodal_distribution"]:
                                page_alert_messages.append("Multiple patterns or changes are detected. ")
                    else:
                        raise ValueError("Invalid mode") 

                    alert_colors = [color for color, flag in triggered.items() if flag]
                    if alert_colors:
                        alert_pages.add(i+1)
                        alerts.append({
                            "mode": mode,
                            "alert_type": alert_colors,
                            "message": page_alert_messages.copy()
                        })
                        # Save results if alert triggered
                        if save_alert_images and save_dir:
                            filename = f"{Path(uploaded_file.filename).stem}_page_{i+1}_{mode}_alert.jpg"
                            save_path = os.path.join(save_dir, filename)
                            cv2.imwrite(save_path, result[mode])
                # Construct the result for this page
                page_result = {
                    "filename": f"{Path(uploaded_file.filename).stem}_page_{i+1}",
                    "alert": 1 if alert_colors else 0,
                    "alerts details": alerts.copy() if alerts else None,
                    "stats": stats
                }
                stats_result.append(page_result)

                #stats_result.append({
                 #   "page": i + 1,
                  #  "alert": 1 if alerts else None,
                   # "alerts details": alerts.copy() if alerts else None,
                    #"stats": stats
                    
                #})

        else:
            img = cv2.imread(filepath)
            if img is None:
                raise HTTPException(status_code=400, detail="Invalid image file")
        
            stats, result = get_pixel_stats(img, modes, inclusive)

            # Trigger Alerts for each mode
            for mode in modes:
                # Trigger Alerts
                # Trigger if any color is too low
                if mode == "minimum":
                    # Initialize a list to collect alert messages for this page
                    page_alert_messages = []
                    thresholds = MODE_THRESHOLDS[mode]
                    
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
                        page_alert_messages.append("No Pixel Detected.")
                    elif triggered["blue"] or triggered["green"] or triggered["red"]:
                        page_alert_messages.append("Parts of the image are too dark or missing colors. ")
                       
                    
                    # Standard deviation alert is triggered 
                    if stats[mode]["std_dev"] < 20:
                        triggered["std_dev"] = True
                        page_alert_messages.append("The image appears flat without depth. ")
                    elif 20 < stats[mode]["std_dev"] < 30:
                        triggered["std_dev"] = True
                        page_alert_messages.append("The image seems unusually noisy. ")
                    elif 90 < stats[mode]["std_dev"] < 100:
                        triggered["std_dev"] = True
                        page_alert_messages.append("The image might be sharper than normal. ")
                    elif stats[mode]["std_dev"] > 100:
                        triggered["std_dev"] = True
                        page_alert_messages.append("The image is excessively sharp. ")

                    if stats[mode]["distribution_peaks"] > 2:
                        triggered["bimodal_distribution"] = True
                        if triggered["bimodal_distribution"]:
                            page_alert_messages.append("Multiple patterns or changes are detected. ")
                        
                # Trigger alert is any color has too few pixels
                # Pixels is counted if the channel is close to the average of all three channels
                elif mode == "average":
                    # Initialize a list to collect alert messages for this page
                    page_alert_messages = []
                    thresholds = MODE_THRESHOLDS[mode]
                    total_pixels = (stats[mode]["blue"] + stats[mode]["green"] + stats[mode]["red"])
                    triggered = {
                        color: stats[mode][color] / total_pixels < thresholds[color]
                        for color in ["blue", "green", "red"]
                    }
                    if triggered["blue"] or triggered["green"] or triggered["red"]:
                        page_alert_messages.append("Colors differ more than expected. ")

                    # Standard deviation alert is triggered 
                    if stats[mode]["std_dev"] < 20:
                        triggered["std_dev"] = True
                        page_alert_messages.append("The image appears flat without depth. ")
                    elif 20 < stats[mode]["std_dev"] < 30:
                        triggered["std_dev"] = True
                        page_alert_messages.append("The image seems unusually noisy. ")
                    elif 90 < stats[mode]["std_dev"] < 100:
                        triggered["std_dev"] = True
                        page_alert_messages.append("likely too sharp")
                    elif stats[mode]["std_dev"] > 100:
                        triggered["std_dev"] = True
                        page_alert_messages.append("image too sharp")

                    if stats[mode]["distribution_peaks"] > 2:
                        triggered["bimodal_distribution"] = True
                        if triggered["bimodal_distribution"]:
                            page_alert_messages.append("Multiple patterns or changes are detected.")

                # Trigger alert is any color is too high
                # Pixels is counted if the channel is highest among all three channels
                elif mode == "maximum":
                    # Initialize a list to collect alert messages for this page
                    page_alert_messages = []
                    thresholds = MODE_THRESHOLDS[mode]
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
                        page_alert_messages.append("One color dominates the image. ")

                    # Standard deviation alert is triggered 
                    if stats[mode]["std_dev"] < 20:
                        triggered["std_dev"] = True
                        page_alert_messages.append("The image appears flat without depth. ")
                    elif 20 < stats[mode]["std_dev"] < 30:
                        triggered["std_dev"] = True
                        page_alert_messages.append("The image seems unusually noisy. ")
                    elif 90 < stats[mode]["std_dev"] < 100:
                        triggered["std_dev"] = True
                        page_alert_messages.append("The image might be sharper than normal. ")
                    elif stats[mode]["std_dev"] > 100:
                        triggered["std_dev"] = True
                        page_alert_messages.append("The image is excessively sharp. ")

                    if stats[mode]["distribution_peaks"] > 2:
                        triggered["bimodal_distribution"] = True
                        if triggered["bimodal_distribution"]:
                            page_alert_messages.append("Multiple patterns or changes are detected. ")
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
                        filename = f"{Path(uploaded_file.filename).stem}_{mode}_alert.jpg"
                        save_path = os.path.join(save_dir, filename)
                        cv2.imwrite(save_path, result[mode])
                
            # Construct the result for this image
            image_result = {
                "filename": Path(uploaded_file.filename).stem,
                "alert": 1 if alert_colors else 0,
                "alerts": alerts.copy() if alerts else None,
                "stats": stats,
            }
            stats_result.append(image_result)

            #stats_result.append({
             #   "alerts": alerts.copy() if alerts else None,
              #  "stats": stats,
            #})

        return stats_result, len(alert_pages), MODE_THRESHOLDS
        
    except Exception as e:
        print(f"Error in file: {str(e)}")
        raise HTTPException(status_code = 500, detail = f"Error in file: {str(e)}")
        
    finally: 
        try: os.remove(filepath)
        except: pass