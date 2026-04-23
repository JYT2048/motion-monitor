"""
Motion Monitor - FastAPI Backend
MediaPipe Pose 推理服务，通过 HTTP POST 接收帧数据，返回姿态关键点
适配微信云托管部署
"""

import base64
import logging
import time
from contextlib import asynccontextmanager
from typing import Optional

import cv2
import mediapipe as mp
import numpy as np
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("motion-monitor")

# =================== MediaPipe Pose (Global) ===================
mp_pose = mp.solutions.pose
pose: Optional[mp_pose.Pose] = None

# 推理缩放目标尺寸（平衡速度与精度）
INFERENCE_WIDTH = 320
INFERENCE_HEIGHT = 240


def init_pose():
    """初始化 MediaPipe Pose 模型"""
    global pose
    if pose is not None:
        return
    logger.info("Initializing MediaPipe Pose model...")
    start = time.time()
    pose = mp_pose.Pose(
        static_image_mode=False,
        model_complexity=0,       # 0=轻量（最快），1=中等，2=重
        smooth_landmarks=True,
        enable_segmentation=False,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    )
    elapsed = time.time() - start
    logger.info(f"MediaPipe Pose model loaded in {elapsed:.2f}s (complexity=0)")


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

    # 缩放到推理尺寸（大幅提升推理速度）
    h, w = image_np.shape[:2]
    if w > INFERENCE_WIDTH or h > INFERENCE_HEIGHT:
        image_np = cv2.resize(image_np, (INFERENCE_WIDTH, INFERENCE_HEIGHT), interpolation=cv2.INTER_LINEAR)

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


def decode_frame(data: dict) -> Optional[np.ndarray]:
    """解码小程序发来的帧数据"""
    try:
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

        raw_bytes = base64.b64decode(b64_data)
        img_array = np.frombuffer(raw_bytes, dtype=np.uint8)

        if fmt == "rgba":
            img_array = img_array.reshape((height, width, 4))
        elif fmt == "rgb":
            img_array = img_array.reshape((height, width, 3))
        else:
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


@app.post("/api/pose")
async def api_pose(body: dict):
    """HTTP POST：发送单帧图片，返回关键点"""
    img_np = decode_frame(body)
    if img_np is None:
        return {"error": "Invalid frame data", "landmarks": None}

    result = process_frame(img_np)
    return {"landmarks": result["landmarks"] if result else None}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
