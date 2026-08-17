import cv2
import numpy as np
from fastapi import UploadFile, File, Form
import time
from typing import Optional, Literal, List
from pydantic import BaseModel
from itertools import compress
import rawpy
from utility import read_gif_with_pillow

class CopyDetectionResult(BaseModel):
    total_keypoints: int
    filtered_keypoints: int
    matches: int
    clusters: int
    regions: int
    processing_time: float
    result_image: str  # base64 encoded
    forensic_warnings: List[str]  # 新增反取证警告字段


DetectorType = Literal["BRISK","ORB","AKAZE"]

class CopyMoveFormInput(BaseModel):
    files: List[UploadFile]
    mask: Optional[UploadFile] = None
    detector: str
    response_threshold: float
    matching_threshold: float
    distance_threshold: float
    cluster_size: int
    show_keypoints: bool
    hide_lines: bool
    use_mask: bool
    anti_forensics: bool = False  # 新增反取证检测选项

    @classmethod
    def as_form(
        cls,
        files: List[UploadFile] = File(...),
        mask: Optional[UploadFile] = File(None),
        detector: DetectorType = Form("BRISK"),
        response_threshold: int = Form(..., ge=0, le=100),
        matching_threshold: int = Form(..., ge=1, le=100),
        distance_threshold: int = Form(..., ge=1, le=100),
        cluster_size: int = Form(..., ge=1, le=20),
        show_keypoints: bool = Form(False),
        hide_lines: bool = Form(False),
        use_mask: bool = Form(False),
        anti_forensics: bool = Form(False)  # 新增参数
    ):
        return cls(
            files=files,
            mask=mask,
            detector=detector,
            response_threshold=response_threshold,
            matching_threshold=matching_threshold,
            distance_threshold=distance_threshold,
            cluster_size=cluster_size,
            show_keypoints=show_keypoints,
            hide_lines=hide_lines,
            use_mask=use_mask,
            anti_forensics=anti_forensics
        )

# 20250806-lynn-新增反取证检测函数
def detect_anti_forensics(gray: np.ndarray) -> List[str]:
    """检测常见的反取证操作"""
    warnings = []
    
    # 1. 检测过度平滑（模糊处理）
    blurred = cv2.medianBlur(gray, 3)
    diff = gray.astype(np.float32) - blurred.astype(np.float32)
    noise_variance = np.var(diff)
    if noise_variance < 5:
        warnings.append(f"Possible anti-forensic smoothing detected (noise variance={noise_variance:.2f})")
    
    # 2. 检测JPEG压缩痕迹
    if len(gray.shape) == 2:
        gray = np.expand_dims(gray, axis=-1)
    laplacian = cv2.Laplacian(cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR), cv2.CV_64F)
    _, stddev = cv2.meanStdDev(laplacian)
    if stddev[0] < 1.5:
        warnings.append(f"Possible over-compression detected (Laplacian stddev={stddev[0]:.2f})")
    
    return warnings

async def process_image(
        image_path: UploadFile = File(...),
        detector_type: Literal["BRISK", "ORB", "AKAZE"] = "BRISK",
        response_threshold: int = 90,
        matching_threshold: int = 20,
        distance_threshold: int = 15,
        cluster_size: int = 5,
        show_keypoints: bool = False,
        hide_lines: bool = False,
        mask_path: Optional[UploadFile] = File(None),
        use_mask: bool = False,
        anti_forensics: bool = False  # 新增参数
) -> dict:
    """Core function matching all conditions from the original Qt widget"""
    start_time = time.time()

    '''
    2025-08-05 lynn注释此处代码， 
    避免磁盘I/O瓶颈 cv2.imread(image_path) 需要物理文件路径，这意味着：

    上传的文件必须先保存到磁盘才能读取，处理结束后需要手动删除临时文件
    在API高并发场景下，磁盘IO会成为性能瓶颈1
    内存流直接处理 优化后的方式通过 imdecode：
    image = cv2.imread(image_path, cv2.IMREAD_COLOR)

    # if image.shape[2] > 3:
    #     image = cv2.cvtColor(image_path, cv2.COLOR_BGRA2BGR)

    image = np.array(image)


    数据类型安全保障
    np.frombuffer(..., np.uint8) 确保：

    二进制流转换为OpenCV要求的uint8格式
    避免浮点数转换导致的数据损失
    明确指定cv2.IMREAD_COLOR保持三通道BGR格式3
    '''

    #image_data = image_path.file.read()  # 获取二进制流
    #image = cv2.imdecode(np.frombuffer(image_data, np.uint8), cv2.IMREAD_COLOR)

    image = cv2.imread(image_path, cv2.IMREAD_COLOR)
    image = np.array(image)

    if image is None:
        return {"error": "Could not read image file"}

    # 20250806-lynn-新增反取证检测
    forensic_warnings = []
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    if anti_forensics:
        forensic_warnings.extend(detect_anti_forensics(gray))

    output = np.copy(image)

    clusters = None
    # Initialize mask if provided
    mask = None
    if use_mask and mask_path:
        try:
            with rawpy.imread(mask_path) as raw:
                mask_img = cv2.cvtColor(raw.postprocess(use_auto_wb=True), cv2.COLOR_RGB2BGR)
        except:
            mask_img = cv2.imread(mask_path, cv2.IMREAD_COLOR)


        if mask_img.shape[2] > 3:
            mask_img = cv2.cvtColor(mask_img, cv2.COLOR_BGRA2BGR)

        if mask_img.shape[:-1] != image.shape[:-1]:
            return {"error": "Mask must have same dimensions as input image"}
        _, mask = cv2.threshold(cv2.cvtColor(mask_img, cv2.COLOR_BGR2GRAY), 0, 1, cv2.THRESH_BINARY)

    # Initialize detector
    detector_map = {
        "BRISK": cv2.BRISK_create(),
        "ORB": cv2.ORB_create(),
        "AKAZE": cv2.AKAZE_create()
    }
    detector = detector_map.get(detector_type)
    if not detector:
        return {"error": f"Invalid detector type: {detector_type}"}
    
    # Keypoint detection
    keypoints, descriptors = detector.detectAndCompute(gray, mask)
    total_kpts = len(keypoints)

    if not keypoints:
        return {
            "total_keypoints": 0,
            "filtered_keypoints": 0,
            "matches": 0,
            "clusters": 0,
            "regions": 0,
            "output_image": output,
            "processing_time": time.time() - start_time,
            "forensic_warnings": forensic_warnings
        }

    # Filter keypoints by response
    responses = np.array([k.response for k in keypoints])

    response_thresh = (100 - response_threshold)

    strong_mask = (cv2.normalize(responses, None, 0, 100, cv2.NORM_MINMAX) >= response_thresh).flatten()

    keypoints = list(compress(keypoints, strong_mask))

    descriptors = descriptors[strong_mask]
    filtered_kpts = len(keypoints)

    if filtered_kpts > 30000:
        return {"error": f"Too many keypoints found ({total_kpts}), please reduce response value","forensic_warnings": forensic_warnings}

    # Matching
    matches = None
    if matches is None:
        matcher = cv2.BFMatcher_create(cv2.NORM_HAMMING, True)
        match_thresh = matching_threshold / 100 * 255
        matches = matcher.radiusMatch(descriptors, descriptors, match_thresh)

        if matches is None:
            return {
                "total_keypoints": total_kpts,
                "filtered_keypoints": filtered_kpts,
                "matches": 0,
                "clusters": 0,
                "regions": 0,
                "output_image": output,
                "processing_time": time.time() - start_time,
                "forensic_warnings": forensic_warnings
            }

        # Process matches
        matches = [m for sublist in matches for m in sublist if m.queryIdx != m.trainIdx]


    # Cluster matches

    if not matches:
        clusters = []
    elif clusters is None:
        clusters = []
        min_dist = (distance_threshold / 100 )* np.min(gray.shape) / 2

        kpts_pts = np.array([k.pt for k in keypoints])

        match_dists = np.linalg.norm(
            [kpts_pts[m.queryIdx] - kpts_pts[m.trainIdx] for m in matches],
            axis=1
        )
        #np.linalg.norm([kpts_a[m.queryIdx] - kpts_a[m.trainIdx] for m in self.matches], axis=1)

        matches = [m for m, d in zip(matches, match_dists) if d > min_dist]
        total_matches = len(matches)

        #clusters = []

        for i, match0 in enumerate(matches):
            group = [match0]
            query0 = match0.queryIdx
            train0 = match0.trainIdx
            d0 = match_dists[i]

            for j in range(i + 1, len(matches)):
                match1 = matches[j]
                query1 = match1.queryIdx
                train1 = match1.trainIdx

                if query1 == train0 and train1 == query0:
                    continue

                d1 = match_dists[j]
                if np.abs(d0 - d1) > min_dist:
                    continue

                a0 = np.array(keypoints[query0].pt)
                b0 = np.array(keypoints[train0].pt)
                a1 = np.array(keypoints[query1].pt)
                b1 = np.array(keypoints[train1].pt)

                aa = np.linalg.norm(a0 - a1)
                bb = np.linalg.norm(b0 - b1)
                ab = np.linalg.norm(a0 - b1)
                ba = np.linalg.norm(b0 - a1)

                if not (0 < aa < min_dist and 0 < bb < min_dist or 0 < ab < min_dist and 0 < ba < min_dist):
                    continue

                for g in group:
                    if g.queryIdx == train1 and g.trainIdx == query1:
                        break
                else:
                    group.append(match1)


            if len(group) >= cluster_size:
                clusters.append(group)


    # Visualization
    hsv = np.zeros((1, 1, 3))
    if show_keypoints:
        for kpt in keypoints:
            cv2.circle(output, (int(kpt.pt[0]), int(kpt.pt[1])), 2, (250, 227, 72))



    angles = []
    for cluster in clusters:
        for match in cluster:
            kpt_a = keypoints[match.queryIdx]
            pt_a = tuple(map(int, kpt_a.pt))
            size_a = int(np.round(kpt_a.size))

            kpt_b = keypoints[match.trainIdx]
            pt_b = tuple(map(int, kpt_b.pt))
            size_b = int(np.round(kpt_b.size))

            angle = np.arctan2(pt_b[1] - pt_a[1], pt_b[0] - pt_a[0])
            if angle < 0:
                angle += np.pi
            angles.append(angle)

            hsv[0, 0, 0] = angle / np.pi * 180
            hsv[0, 0, 1] = 255
            hsv[0, 0, 2] = match.distance / match_thresh * 255

            rgb = cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)
            rgb = tuple([int(x) for x in rgb[0, 0]])
            cv2.circle(output, pt_a, size_a, rgb, 1, cv2.LINE_AA)
            cv2.circle(output, pt_b, size_b, rgb, 1, cv2.LINE_AA)

            if not hide_lines:
                cv2.line(output, pt_a, pt_b, rgb, 1, cv2.LINE_AA)

    # Region detection
    regions = 0
    if angles:

        angles = np.reshape(np.array(angles, dtype=np.float32), (len(angles), 1))

        if np.std(angles) < 0.1:
            regions = 1

        else:

            criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 10, 1.0)

            try:
                compactness = [
                    cv2.kmeans(angles, k, None, criteria, 10, cv2.KMEANS_PP_CENTERS)[0]
                    for k in range(1, 11)
                ]

                compactness = cv2.normalize(np.array(compactness), None, 0, 1, cv2.NORM_MINMAX)

                regions = np.argmax(compactness < 0.005) + 1
            except:
                pass



    return {
        "total_keypoints": total_kpts,
        "filtered_keypoints": filtered_kpts,
        "matches": len(matches),
        "clusters": len(clusters),
        "regions": regions,
        "output_image": output,
        "processing_time": time.time() - start_time,
        "forensic_warnings": forensic_warnings  # 返回反取证警告
    }


def process_image_no_async(
        image_path: UploadFile = File(...),
        detector_type: Literal["BRISK", "ORB", "AKAZE"] = "BRISK",
        response_threshold: int = 90,
        matching_threshold: int = 20,
        distance_threshold: int = 15,
        cluster_size: int = 5,
        show_keypoints: bool = False,
        hide_lines: bool = False,
        mask_path: Optional[UploadFile] = File(None),
        use_mask: bool = False,
        anti_forensics: bool = False  # 新增参数
) -> dict:
    """Core function matching all conditions from the original Qt widget"""
    start_time = time.time()

    '''
    2025-08-05 lynn注释此处代码， 
    避免磁盘I/O瓶颈 cv2.imread(image_path) 需要物理文件路径，这意味着：

    上传的文件必须先保存到磁盘才能读取，处理结束后需要手动删除临时文件
    在API高并发场景下，磁盘IO会成为性能瓶颈1
    内存流直接处理 优化后的方式通过 imdecode：
    image = cv2.imread(image_path, cv2.IMREAD_COLOR)

    # if image.shape[2] > 3:
    #     image = cv2.cvtColor(image_path, cv2.COLOR_BGRA2BGR)

    image = np.array(image)


    数据类型安全保障
    np.frombuffer(..., np.uint8) 确保：

    二进制流转换为OpenCV要求的uint8格式
    避免浮点数转换导致的数据损失
    明确指定cv2.IMREAD_COLOR保持三通道BGR格式3
    '''

    #image_data = image_path.file.read()  # 获取二进制流
    #image = cv2.imdecode(np.frombuffer(image_data, np.uint8), cv2.IMREAD_COLOR)

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

    #image = cv2.imread(image_path, cv2.IMREAD_COLOR)

    if image is None:
        return {"error": "Could not read image file"}
    image = np.array(image)

    # 20250806-lynn-新增反取证检测
    forensic_warnings = []
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    if anti_forensics:
        forensic_warnings.extend(detect_anti_forensics(gray))

    output = np.copy(image)

    clusters = None
    # Initialize mask if provided
    mask = None
    if use_mask and mask_path:
        try:
            with rawpy.imread(mask_path) as raw:
                mask_img = cv2.cvtColor(raw.postprocess(use_auto_wb=True), cv2.COLOR_RGB2BGR)
        except:
            mask_img = cv2.imread(mask_path, cv2.IMREAD_COLOR)


        if mask_img.shape[2] > 3:
            mask_img = cv2.cvtColor(mask_img, cv2.COLOR_BGRA2BGR)

        if mask_img.shape[:-1] != image.shape[:-1]:
            return {"error": "Mask must have same dimensions as input image"}
        _, mask = cv2.threshold(cv2.cvtColor(mask_img, cv2.COLOR_BGR2GRAY), 0, 1, cv2.THRESH_BINARY)

    # Initialize detector
    detector_map = {
        "BRISK": cv2.BRISK_create(),
        "ORB": cv2.ORB_create(),
        "AKAZE": cv2.AKAZE_create()
    }
    detector = detector_map.get(detector_type)
    if not detector:
        return {"error": f"Invalid detector type: {detector_type}"}
    
    # Keypoint detection
    keypoints, descriptors = detector.detectAndCompute(gray, mask)
    total_kpts = len(keypoints)

    if not keypoints:
        return {
            "total_keypoints": 0,
            "filtered_keypoints": 0,
            "matches": 0,
            "clusters": 0,
            "regions": 0,
            "output_image": output,
            "processing_time": time.time() - start_time,
            "forensic_warnings": forensic_warnings
        }

    # Filter keypoints by response
    responses = np.array([k.response for k in keypoints])

    response_thresh = (100 - response_threshold)

    strong_mask = (cv2.normalize(responses, None, 0, 100, cv2.NORM_MINMAX) >= response_thresh).flatten()

    keypoints = list(compress(keypoints, strong_mask))

    descriptors = descriptors[strong_mask]
    filtered_kpts = len(keypoints)

    if filtered_kpts > 30000:
        return {"error": f"Too many keypoints found ({total_kpts}), please reduce response value","forensic_warnings": forensic_warnings}

    # Matching
    matches = None
    if matches is None:
        matcher = cv2.BFMatcher_create(cv2.NORM_HAMMING, True)
        match_thresh = matching_threshold / 100 * 255
        matches = matcher.radiusMatch(descriptors, descriptors, match_thresh)

        if matches is None:
            return {
                "total_keypoints": total_kpts,
                "filtered_keypoints": filtered_kpts,
                "matches": 0,
                "clusters": 0,
                "regions": 0,
                "output_image": output,
                "processing_time": time.time() - start_time,
                "forensic_warnings": forensic_warnings
            }

        # Process matches
        matches = [m for sublist in matches for m in sublist if m.queryIdx != m.trainIdx]


    # Cluster matches

    if not matches:
        clusters = []
    elif clusters is None:
        clusters = []
        min_dist = (distance_threshold / 100 )* np.min(gray.shape) / 2

        kpts_pts = np.array([k.pt for k in keypoints])

        match_dists = np.linalg.norm(
            [kpts_pts[m.queryIdx] - kpts_pts[m.trainIdx] for m in matches],
            axis=1
        )
        #np.linalg.norm([kpts_a[m.queryIdx] - kpts_a[m.trainIdx] for m in self.matches], axis=1)

        matches = [m for m, d in zip(matches, match_dists) if d > min_dist]
        total_matches = len(matches)

        #clusters = []

        for i, match0 in enumerate(matches):
            group = [match0]
            query0 = match0.queryIdx
            train0 = match0.trainIdx
            d0 = match_dists[i]

            for j in range(i + 1, len(matches)):
                match1 = matches[j]
                query1 = match1.queryIdx
                train1 = match1.trainIdx

                if query1 == train0 and train1 == query0:
                    continue

                d1 = match_dists[j]
                if np.abs(d0 - d1) > min_dist:
                    continue

                a0 = np.array(keypoints[query0].pt)
                b0 = np.array(keypoints[train0].pt)
                a1 = np.array(keypoints[query1].pt)
                b1 = np.array(keypoints[train1].pt)

                aa = np.linalg.norm(a0 - a1)
                bb = np.linalg.norm(b0 - b1)
                ab = np.linalg.norm(a0 - b1)
                ba = np.linalg.norm(b0 - a1)

                if not (0 < aa < min_dist and 0 < bb < min_dist or 0 < ab < min_dist and 0 < ba < min_dist):
                    continue

                for g in group:
                    if g.queryIdx == train1 and g.trainIdx == query1:
                        break
                else:
                    group.append(match1)


            if len(group) >= cluster_size:
                clusters.append(group)


    # Visualization
    hsv = np.zeros((1, 1, 3))
    if show_keypoints:
        for kpt in keypoints:
            cv2.circle(output, (int(kpt.pt[0]), int(kpt.pt[1])), 2, (250, 227, 72))



    angles = []
    for cluster in clusters:
        for match in cluster:
            kpt_a = keypoints[match.queryIdx]
            pt_a = tuple(map(int, kpt_a.pt))
            size_a = int(np.round(kpt_a.size))

            kpt_b = keypoints[match.trainIdx]
            pt_b = tuple(map(int, kpt_b.pt))
            size_b = int(np.round(kpt_b.size))

            angle = np.arctan2(pt_b[1] - pt_a[1], pt_b[0] - pt_a[0])
            if angle < 0:
                angle += np.pi
            angles.append(angle)

            hsv[0, 0, 0] = angle / np.pi * 180
            hsv[0, 0, 1] = 255
            hsv[0, 0, 2] = match.distance / match_thresh * 255

            rgb = cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)
            rgb = tuple([int(x) for x in rgb[0, 0]])
            cv2.circle(output, pt_a, size_a, rgb, 1, cv2.LINE_AA)
            cv2.circle(output, pt_b, size_b, rgb, 1, cv2.LINE_AA)

            if not hide_lines:
                cv2.line(output, pt_a, pt_b, rgb, 1, cv2.LINE_AA)

    # Region detection
    regions = 0
    if angles:

        angles = np.reshape(np.array(angles, dtype=np.float32), (len(angles), 1))

        if np.std(angles) < 0.1:
            regions = 1

        else:

            criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 10, 1.0)

            try:
                compactness = [
                    cv2.kmeans(angles, k, None, criteria, 10, cv2.KMEANS_PP_CENTERS)[0]
                    for k in range(1, 11)
                ]

                compactness = cv2.normalize(np.array(compactness), None, 0, 1, cv2.NORM_MINMAX)

                regions = np.argmax(compactness < 0.005) + 1
            except:
                pass



    return {
        "total_keypoints": total_kpts,
        "filtered_keypoints": filtered_kpts,
        "matches": len(matches),
        "clusters": len(clusters),
        "regions": regions,
        "output_image": output,
        "processing_time": time.time() - start_time,
        "forensic_warnings": forensic_warnings  # 返回反取证警告
    }