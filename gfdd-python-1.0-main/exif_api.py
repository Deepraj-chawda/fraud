from pyexiftool import exiftool
from utility import exiftool_exe
from task_progress import add_progress, update_progress
import os
import mimetypes
import pdfplumber
import fitz  # PyMuPDF

TEMP_IMG_DIR = os.path.join(os.path.dirname(__file__), "temp_images")
os.makedirs(TEMP_IMG_DIR, exist_ok=True)

def extract_exif(filepaths, session_id):
    """
    批量提取图片（JPG, HEIC, HEIF等）和PDF的EXIF/内容信息，支持进度跟踪和PDF多页分析。

    Args:
        filepaths (list): 文件路径列表。
        session_id (str): 会话ID，用于进度跟踪。

    Returns:
        list: 每个文件的分析结果。
    """
    ignore = [
        "SourceFile",
        "ExifTool:ExifTool",
        "File:FileName",
        "File:Directory",
        "File:FileSize",
        "File:FileModifyDate",
        "File:FileInodeChangeDate",
        "File:FileAccessDate",
        "File:FileType",
        "File:FilePermissions",
        "File:FileTypeExtension",
        "File:MIMEType",
    ]
    results = []
    add_progress(session_id, len(filepaths))  # 初始化进度

    for idx, filepath in enumerate(filepaths):
        filename = os.path.basename(filepath)
        mimetype, _ = mimetypes.guess_type(filepath)
        file_result = {"filename": filename, "type": None, "analysis": []}

        try:
            if mimetype and mimetype.startswith("image"):
                file_result["type"] = "image"
                with exiftool.ExifTool(exiftool_exe()) as et:
                    metadata = et.get_metadata(filepath)
                    data = {}
                    for tag, value in metadata.items():
                        if not value or any(t in tag for t in ignore):
                            continue
                        value = str(value).replace(", use -b option to extract", "")
                        value = value.replace("Binary data ", "Binary data: ")
                        if ":" in tag:
                            group, desc = tag.split(":", 1)
                        else:
                            group, desc = "Other", tag
                        if group in data:
                            data[group].append([desc, value])
                        else:
                            data[group] = [[desc, value]]
                    file_result["analysis"].append({"exif": data})
            elif mimetype == "application/pdf" or filepath.lower().endswith(".pdf"):
                file_result["type"] = "pdf"
                try:
                    doc = fitz.open(filepath)
                    for i, page in enumerate(doc):
                        pix = page.get_pixmap()
                        tmp_img_path = os.path.join(TEMP_IMG_DIR, f"{os.path.splitext(filename)[0]}_page{i+1}.jpg")
                        pix.save(tmp_img_path)
                        with exiftool.ExifTool(exiftool_exe()) as et:
                            metadata = et.get_metadata(tmp_img_path)
                            data = {}
                            for tag, value in metadata.items():
                                if not value or any(t in tag for t in ignore):
                                    continue
                                value = str(value).replace(", use -b option to extract", "")
                                value = value.replace("Binary data ", "Binary data: ")
                                if ":" in tag:
                                    group, desc = tag.split(":", 1)
                                else:
                                    group, desc = "Other", tag
                                if group in data:
                                    data[group].append([desc, value])
                                else:
                                    data[group] = [[desc, value]]
                        page_text = ""
                        try:
                            with pdfplumber.open(filepath) as pdf:
                                if i < len(pdf.pages):
                                    page_text = pdf.pages[i].extract_text() or ""
                        except Exception:
                            pass
                        page_report = {
                            "page": i + 1,
                            "text": page_text,
                            "exif": data
                        }
                        file_result["analysis"].append(page_report)
                        try:
                            os.remove(tmp_img_path)
                        except Exception as e:
                            file_result.setdefault("warnings", []).append(f"临时图片删除失败: {str(e)}")
                except Exception as e:
                    file_result["error"] = str(e)
            else:
                file_result["type"] = "unknown"
                file_result["error"] = "不支持的文件类型"
        finally:
            results.append(file_result)
            update_progress(session_id, idx + 1, filename)  # 更新进度

    return results
