"""
Motion Monitor - FastAPI Backend
MediaPipe Pose 推理服务，通过 WebSocket 接收帧数据，返回姿态关键点
适配微信云托管部署
"""

import asyncio
import base64
import io
import json
import logging
import math
import signal
import time
from contextlib import asynccontextmanager
from typing import Optional

import cv2
import mediapipe as mp
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image

# Logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("motion-monitor")

# =================== MediaPipe Pose (Global) ===================
mp_pose = mp.solutions.pose
pose: Optional[mp_pose.Pose] = None


def init_pose():
    """初始化 MediaPipe Pose 模型"""
    global pose
    if pose is not None:
        return
    logger.info("Initializing MediaPipe Pose model...")
    start = time.time()
    pose = mp_pose.Pose(
        static_image_mode=False,
        model_complexity=1,
        smooth_landmarks=True,
        enable_segmentation=False,
        min_detection_confidence=0.6,
        min_tracking_confidence=0.5,
    )
    elapsed = time.time() - start
    logger.info(f"MediaPipe Pose model loaded in {elapsed:.2f}s")


def cleanup_pose():
    """释放 MediaPipe Pose 模型资源"""
    global pose
    if pose is not None:
        logger.info("Releasing MediaPipe Pose model...")
        pose.close()
        pose = None
        logger.info("MediaPipe Pose model released")


# =================== Lifespan (Startup/Shutdown) ===================
@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理：启动时加载模型，关闭时释放资源"""
    init_pose()
    logger.info("Motion Monitor API started successfully")
    yield
    cleanup_pose()
    logger.info("Motion Monitor API shutdown complete")


app = FastAPI(title="Motion Monitor API", lifespan=lifespan)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# =================== Frame Processing ===================
def process_frame(image_np: np.ndarray) -> Optional[dict]:
    """处理单帧图像，返回关键点"""
    if pose is None:
        logger.warning("Pose model not initialized")
        return None

    # MediaPipe Needs RGB
    rgb = cv2.cvtColor(image_np, cv2.COLOR_RGBA2RGB) if image_np.shape[2] == 4 else image_np
    results = pose.process(rgb)

    if not results.pose_landmarks:
        return None

    landmarks = []
    for lm in results.pose_landmarks.landmark:
        landmarks.append({
            "x": lm.x,
            "y": lm.y,
            "z": lm.z,
            "visibility": lm.visibility,
        })

    return {"landmarks": landmarks}


# =================== Posture Assessment ===================
def calc_angle_3d(a: dict, b: dict, c: dict) -> float:
    """计算三点夹角（度），a-b-c 中 b 为顶点"""
    ba = {"x": a["x"] - b["x"], "y": a["y"] - b["y"], "z": a.get("z", 0) - b.get("z", 0)}
    bc = {"x": c["x"] - b["x"], "y": c["y"] - b["y"], "z": c.get("z", 0) - b.get("z", 0)}
    dot = ba["x"] * bc["x"] + ba["y"] * bc["y"] + ba["z"] * bc["z"]
    mag_ba = math.sqrt(ba["x"]**2 + ba["y"]**2 + ba["z"]**2)
    mag_bc = math.sqrt(bc["x"]**2 + bc["y"]**2 + bc["z"]**2)
    if mag_ba == 0 or mag_bc == 0:
        return 0.0
    cos_angle = max(-1.0, min(1.0, dot / (mag_ba * mag_bc)))
    return math.degrees(math.acos(cos_angle))


def assess_posture(lm: list) -> dict:
    """
    体态评估：基于 MediaPipe 33 关键点，从正面和侧面两个维度分析
    
    关键点索引：
    0=鼻, 7=左耳, 8=右耳
    11=左肩, 12=右肩, 13=左肘, 14=右肘
    23=左髋, 24=右髋, 25=左膝, 26=右膝
    27=左踝, 28=右踝
    """
    # 检查关键点可见性
    required = [0, 7, 8, 11, 12, 23, 24, 25, 26, 27, 28]
    for idx in required:
        if idx >= len(lm) or lm[idx].get("visibility", 0) < 0.4:
            return {
                "error": "Key landmarks not visible, please ensure full body is in frame",
                "posture": None,
            }

    # ============ 1. 头部前倾（探颈） ============
    # 侧面观：耳(7) 相对肩(11) 在 z 轴的前后偏移
    # z > 0 表示靠近相机（前倾），z < 0 表示远离相机（后仰）
    ear_z = (lm[7]["z"] + lm[8]["z"]) / 2
    shoulder_z = (lm[11]["z"] + lm[12]["z"]) / 2
    ear_x = (lm[7]["x"] + lm[8]["x"]) / 2
    shoulder_x = (lm[11]["x"] + lm[12]["x"]) / 2
    # 用 z 差值估算前倾角度（归一化坐标系下近似）
    head_forward_offset = shoulder_z - ear_z  # 正值=头前伸
    # 耳-肩在矢状面的角度
    head_forward_angle = math.degrees(math.atan2(
        abs(shoulder_x - ear_x),
        abs(shoulder_z - ear_z) if abs(shoulder_z - ear_z) > 0.001 else 0.001
    ))
    # 简化判定：头在 z 方向比肩更靠前
    head_forward_deg = abs(ear_z - shoulder_z) * 180  # 近似角度映射
    if head_forward_offset < -0.02:
        head_forward_status = "warning"  # 探颈
        head_forward_label = "探颈倾向"
    elif head_forward_offset < -0.05:
        head_forward_status = "poor"
        head_forward_label = "明显探颈"
    else:
        head_forward_status = "normal"
        head_forward_label = "正常"

    # ============ 2. 高低肩 ============
    # 正面观：左右肩 y 坐标差值
    shoulder_diff = abs(lm[11]["y"] - lm[12]["y"])
    if shoulder_diff < 0.02:
        shoulder_level_status = "normal"
        shoulder_level_label = "正常"
    elif shoulder_diff < 0.04:
        shoulder_level_status = "warning"
        shoulder_level_label = "轻微高低肩"
    else:
        shoulder_level_status = "poor"
        shoulder_level_label = "明显高低肩"
    higher_side = "左肩高" if lm[11]["y"] < lm[12]["y"] else "右肩高"

    # ============ 3. 圆肩 ============
    # 侧面观：肩峰相对于髋部的前后偏移（z轴）
    hip_z = (lm[23]["z"] + lm[24]["z"]) / 2
    shoulder_forward = shoulder_z - hip_z  # 负值=肩前移（圆肩）
    if shoulder_forward > 0.03:
        rounded_shoulder_status = "warning"
        rounded_shoulder_label = "圆肩倾向"
    elif shoulder_forward > 0.06:
        rounded_shoulder_status = "poor"
        rounded_shoulder_label = "明显圆肩"
    else:
        rounded_shoulder_status = "normal"
        rounded_shoulder_label = "正常"

    # ============ 4. 骨盆前倾 ============
    # 侧面观：肩-髋-膝的矢状面角度
    # 正常站立时髋角约 170-180°，骨盆前倾时角度变小
    hip_angle_left = calc_angle_3d(lm[11], lm[23], lm[25])
    hip_angle_right = calc_angle_3d(lm[12], lm[24], lm[26])
    hip_angle_avg = (hip_angle_left + hip_angle_right) / 2
    # 正常髋角 > 160°，< 150° 为骨盆前倾
    if hip_angle_avg >= 160:
        pelvic_tilt_status = "normal"
        pelvic_tilt_label = "正常"
    elif hip_angle_avg >= 150:
        pelvic_tilt_status = "warning"
        pelvic_tilt_label = "轻度骨盆前倾"
    else:
        pelvic_tilt_status = "poor"
        pelvic_tilt_label = "明显骨盆前倾"

    # ============ 5. 脊柱侧弯倾向 ============
    # 正面观：鼻-胸中-髋中 的水平偏移
    nose_x = lm[0]["x"]
    chest_x = (lm[11]["x"] + lm[12]["x"]) / 2
    hip_center_x = (lm[23]["x"] + lm[24]["x"]) / 2
    # 鼻到髋中点连线的偏移
    spine_offset = abs(nose_x - hip_center_x)
    # 上段偏移（鼻-胸）
    upper_offset = abs(nose_x - chest_x)
    # 下段偏移（胸-髋）
    lower_offset = abs(chest_x - hip_center_x)
    if spine_offset < 0.03:
        scoliosis_status = "normal"
        scoliosis_label = "正常"
    elif spine_offset < 0.06:
        scoliosis_status = "warning"
        scoliosis_label = "侧弯倾向"
    else:
        scoliosis_status = "poor"
        scoliosis_label = "明显侧弯"

    # ============ 6. 膝关节（X/O型腿） ============
    # 正面观：髋-膝-踝角度
    knee_angle_left = calc_angle_3d(lm[23], lm[25], lm[27])
    knee_angle_right = calc_angle_3d(lm[24], lm[26], lm[28])
    knee_angle_avg = (knee_angle_left + knee_angle_right) / 2
    if 170 <= knee_angle_avg <= 185:
        knee_status = "normal"
        knee_label = "正常"
    elif knee_angle_avg < 170:
        knee_status = "warning"
        knee_label = "O型腿倾向"
    else:
        knee_status = "warning"
        knee_label = "X型腿倾向"

    # ============ 综合评分 ============
    # 每项 normal=100分, warning=60分, poor=30分
    score_map = {"normal": 100, "warning": 60, "poor": 30}
    items = [
        head_forward_status,
        shoulder_level_status,
        rounded_shoulder_status,
        pelvic_tilt_status,
        scoliosis_status,
        knee_status,
    ]
    scores = [score_map[s] for s in items]
    overall_score = round(sum(scores) / len(scores))
    if overall_score >= 80:
        overall_status = "good"
        overall_label = "体态良好"
        overall_emoji = "✅"
    elif overall_score >= 60:
        overall_status = "warning"
        overall_label = "体态需改善"
        overall_emoji = "⚠️"
    else:
        overall_status = "poor"
        overall_label = "体态较差"
        overall_emoji = "❌"

    return {
        "overall_score": overall_score,
        "overall_status": overall_status,
        "overall_label": overall_label,
        "overall_emoji": overall_emoji,
        "details": {
            "head_forward": {
                "label": "头部前倾",
                "angle": round(head_forward_deg, 1),
                "status": head_forward_status,
                "desc": head_forward_label,
            },
            "shoulder_level": {
                "label": "高低肩",
                "diff": round(shoulder_diff * 100, 2),
                "status": shoulder_level_status,
                "desc": shoulder_level_label + (" (" + higher_side + ")" if shoulder_level_status != "normal" else ""),
            },
            "rounded_shoulder": {
                "label": "圆肩",
                "offset": round(shoulder_forward * 100, 2),
                "status": rounded_shoulder_status,
                "desc": rounded_shoulder_label,
            },
            "pelvic_tilt": {
                "label": "骨盆前倾",
                "angle": round(hip_angle_avg, 1),
                "status": pelvic_tilt_status,
                "desc": pelvic_tilt_label,
            },
            "scoliosis": {
                "label": "脊柱侧弯",
                "offset": round(spine_offset * 100, 2),
                "status": scoliosis_status,
                "desc": scoliosis_label,
            },
            "knee": {
                "label": "膝关节",
                "angle": round(knee_angle_avg, 1),
                "status": knee_status,
                "desc": knee_label,
            },
        },
    }





def decode_frame(data: dict) -> Optional[np.ndarray]:
    """解码小程序发来的帧数据"""
    try:
        # 优先处理 JPEG 格式（前端压缩后发送）
        fmt = data.get("format", "rgba")

        if fmt == "jpeg":
            b64_data = data.get("image", "") or data.get("data", "")
            if not b64_data:
                return None
            raw_bytes = base64.b64decode(b64_data)
            img_array = np.frombuffer(raw_bytes, dtype=np.uint8)
            img_array = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
            return img_array

        # 原始 RGBA 格式
        b64_data = data.get("data", "")
        width = data.get("width", 0)
        height = data.get("height", 0)

        if not b64_data or not width or not height:
            return None

        # Decode base64 -> bytes -> numpy array
        raw_bytes = base64.b64decode(b64_data)
        img_array = np.frombuffer(raw_bytes, dtype=np.uint8)

        if fmt == "rgba":
            img_array = img_array.reshape((height, width, 4))
        elif fmt == "rgb":
            img_array = img_array.reshape((height, width, 3))
        else:
            # Try JPEG
            img_array = cv2.imdecode(img_array, cv2.IMREAD_COLOR)

        return img_array
    except Exception as e:
        logger.warning(f"Decode frame error: {e}")
        return None


# =================== HTTP Endpoints ===================
@app.get("/")
async def root():
    return {"service": "Motion Monitor API", "status": "running"}


@app.get("/health")
async def health():
    """云托管健康检查端点"""
    return {
        "status": "ok",
        "pose_loaded": pose is not None,
    }


# =================== WebSocket ===================
@app.websocket("/ws/pose")
async def ws_pose(websocket: WebSocket):
    """WebSocket 端点：接收帧数据，返回姿态关键点"""
    await websocket.accept()
    logger.info("WS client connected")

    frame_count = 0
    start_time = time.time()

    try:
        while True:
            # Receive frame data
            raw = await websocket.receive_text()
            data = json.loads(raw)

            if data.get("type") != "frame":
                continue

            # Decode frame
            img_np = decode_frame(data)
            if img_np is None:
                continue

            # Process with MediaPipe
            result = process_frame(img_np)

            frame_count += 1
            elapsed = time.time() - start_time
            fps = frame_count / elapsed if elapsed > 0 else 0

            # Send result
            response = {
                "landmarks": result["landmarks"] if result else None,
                "fps": round(fps, 1),
                "frame": frame_count,
            }

            await websocket.send_text(json.dumps(response))

    except WebSocketDisconnect:
        logger.info(f"WS client disconnected. Total frames: {frame_count}")
    except Exception as e:
        logger.error(f"WS error: {e}")
    finally:
        logger.info("WS session ended")


# =================== HTTP Post fallback ===================
@app.post("/api/pose")
async def api_pose(body: dict):
    """HTTP POST 备选方案：发送单帧图片，返回关键点（微信云托管 callContainer 使用）"""
    img_np = decode_frame(body)
    if img_np is None:
        return {"error": "Invalid frame data", "landmarks": None}

    result = process_frame(img_np)
    return {"landmarks": result["landmarks"] if result else None}


@app.post("/api/posture")
async def api_posture(body: dict):
    """体态评估：发送单帧图片，返回关键点 + 体态分析结果"""
    img_np = decode_frame(body)
    if img_np is None:
        return {"error": "Invalid frame data", "landmarks": None, "posture": None}

    result = process_frame(img_np)
    if not result:
        return {"error": "No pose detected", "landmarks": None, "posture": None}

    posture = assess_posture(result["landmarks"])
    return {"landmarks": result["landmarks"], "posture": posture}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
